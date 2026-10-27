import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string, service: string, otherTenantUser: string;
let itemA: string, itemA2: string, itemB: string, connA: string, connB: string;
const DENIED = "42501";
const H = (c: string) => c.repeat(64);

const pull = (actor: string, item: string, fields: unknown, base: unknown = null) =>
  db.asService((q) => q("select public.github_apply_pull($1, $2, $3::jsonb, $4::jsonb) as r", [actor, item, JSON.stringify(fields), base === null ? null : JSON.stringify(base)]).then((r) => r.rows[0].r as Record<string, unknown>), { commit: true, via: "UI" });
const record = (actor: string, item: string, base: unknown) => db.asService((q) => q("select public.github_record_base($1, $2, $3::jsonb)", [actor, item, JSON.stringify(base)]), { commit: true, via: "UI" });
const item = async (id: string) => (await db.admin.query("select initiative_name, summary, description, hypothesis, value_12m, confidence, decision, stack_rank from public.items where id = $1", [id])).rows[0];
const link = async (id: string) => (await db.admin.query("select sync_base, sync_checked_at from public.item_github_links where item_id = $1", [id])).rows[0];

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-pull@example.test");
  viewer = await createUser(db, "viewer-pull@example.test");
  service = await createUser(db, "service-pull@example.test");
  otherTenantUser = await createUser(db, "other-pull@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  await addMember(db, f.alice, f.tenantA, service, "creator", { serviceAccount: true });
  await db.admin.query("delete from public.item_github_links");
  const ids = (await db.admin.query("select id from public.items where tenant_id = $1 order by stack_rank limit 2", [f.tenantA])).rows.map((r) => r.id as string);
  [itemA, itemA2] = ids;
  connA = (await db.admin.query("select id from public.github_connections where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id;
  itemB = (await db.admin.query("select id from public.items where tenant_id = $1 limit 1", [f.tenantB])).rows[0].id;
  connB = (await db.admin.query("select id from public.github_connections where tenant_id = $1 limit 1", [f.tenantB])).rows[0].id;
  for (const [t, i, c, n, mode] of [[f.tenantA, itemA, connA, 1, "push"], [f.tenantA, itemA2, connA, 2, "follow"], [f.tenantB, itemB, connB, 3, "push"]] as const) {
    await db.admin.query("insert into public.item_github_links (tenant_id, item_id, connection_id, repo_full_name, issue_number, issue_id, html_url, sync_state, mode) values ($1, $2, $3, 'Acme/App', $4, $5, 'https://github.com/Acme/App/issues/1', 'synced', $6)", [t, i, c, n, 9200 + n, mode]);
  }
});
afterAll(async () => { await db.close(); });

describe("github_apply_pull changes only the four allowlisted texts", () => {
  it("applies the chosen texts, returns the replaced values, audits the person and the source", async () => {
    const before = await item(itemA);
    const replaced = await pull(creator, itemA, { initiative_name: "Renamed in GitHub", description: "New description" }, { title: H("a"), description: H("b") });
    expect(replaced).toMatchObject({ initiative_name: before.initiative_name, description: before.description });
    expect(await item(itemA)).toMatchObject({ initiative_name: "Renamed in GitHub", description: "New description", summary: before.summary });
    const a = (await db.admin.query("select actor_id, via, new #>> '{}' as v from public.audit_log where entity = 'items' and entity_id = $1 and field = 'initiative_name' order by id desc limit 1", [itemA])).rows[0];
    expect(a).toMatchObject({ actor_id: creator, via: "UI", v: "Renamed in GitHub" });
    expect((await link(itemA)).sync_base).toEqual({ title: H("a"), description: H("b") });
  });
  it("refuses every field outside the allowlist, and changes nothing (hostile payload)", async () => {
    const before = await item(itemA);
    for (const key of ["value_12m", "confidence", "decision", "stack_rank", "tenant_id", "customers_requesting", "moscow"]) {
      expect(await errorCode(pull(creator, itemA, { summary: "Sneaky", [key]: "999999" })), key).toBe("22023");
    }
    expect(await item(itemA)).toEqual(before);
  });
  it("refuses non-text values, an empty name, and takes over nothing for a follow link", async () => {
    expect(await errorCode(pull(creator, itemA, { summary: { a: 1 } }))).toBe("22023");
    expect(await errorCode(pull(creator, itemA, { initiative_name: "   " }))).toBe("22023");
    expect(await errorCode(pull(creator, itemA2, { summary: "x" }))).toBe("P0002");
  });
  it("cuts a text at the field limit instead of failing the sync", async () => {
    await pull(creator, itemA, { summary: "s".repeat(5000) });
    expect(((await item(itemA)).summary as string).length).toBe(4000);
  });
});

describe("github_apply_pull also takes over the four board values, and only those", () => {
  const col = async (id: string) => (await db.admin.query("select moscow, theme, end_date::text as end_date, effort, value_12m, confidence, decision from public.items where id = $1", [id])).rows[0];
  it("sets MoSCoW, an existing Initiative Group, the date and the size, returns what was replaced, audits the person", async () => {
    await db.admin.query("insert into public.item_groups (tenant_id, name) values ($1, 'Platform') on conflict do nothing", [f.tenantA]);
    const before = await col(itemA);
    const replaced = await pull(creator, itemA, { moscow: "Should", theme: "platform", end_date: "2027-03-31", effort: "XL" }, { priority: H("1"), group: H("2"), due: H("3"), size: H("4") });
    expect(replaced).toEqual({ moscow: before.moscow, theme: before.theme, end_date: before.end_date, effort: before.effort });
    expect(await col(itemA)).toMatchObject({ moscow: "Should", theme: "Platform", end_date: "2027-03-31", effort: "XL", value_12m: before.value_12m, confidence: before.confidence, decision: before.decision });
    const a = (await db.admin.query("select actor_id, via from public.audit_log where entity = 'items' and entity_id = $1 and field = 'moscow' order by id desc limit 1", [itemA])).rows[0];
    expect(a).toMatchObject({ actor_id: creator, via: "UI" });
    expect((await link(itemA)).sync_base).toMatchObject({ priority: H("1"), group: H("2"), due: H("3"), size: H("4") });
  });
  it("refuses a value that does not belong, and an Initiative Group that does not exist (nothing is created)", async () => {
    const before = await col(itemA);
    for (const bad of [{ moscow: "Won't" }, { moscow: "P0" }, { effort: "XXL" }, { end_date: "tomorrow" }, { end_date: "2027-13-45" }, { theme: "Invented by GitHub" }]) {
      expect(await errorCode(pull(creator, itemA, bad)), JSON.stringify(bad)).toBe("22023");
    }
    expect(await col(itemA)).toEqual(before);
    expect((await db.admin.query("select count(*)::int as n from public.item_groups where tenant_id = $1 and name = 'Invented by GitHub'", [f.tenantA])).rows[0].n).toBe(0);
  });
  it("a date before Planned Start is refused by the table's own check and changes nothing", async () => {
    await db.admin.query("update public.items set start_date = '2027-03-15' where id = $1", [itemA]);
    const before = await col(itemA);
    await expect(pull(creator, itemA, { end_date: "2027-01-01" })).rejects.toBeTruthy();
    expect(await col(itemA)).toEqual(before);
    await db.admin.query("update public.items set start_date = null where id = $1", [itemA]);
  });
  it("a group of another workspace is not found: groups are looked up in the item's own workspace", async () => {
    await db.admin.query("insert into public.item_groups (tenant_id, name) values ($1, 'OnlyInB') on conflict do nothing", [f.tenantB]);
    expect(await errorCode(pull(creator, itemA, { theme: "OnlyInB" }))).toBe("22023");
  });
  it("the board keys are accepted in the base as hashes only", async () => {
    await expect(record(creator, itemA, { priority: "P0" })).rejects.toBeTruthy();
    await record(creator, itemA, { due: H("a") });
    expect((await link(itemA)).sync_base).toMatchObject({ due: H("a") });
  });
});

describe("who may sync, and across workspaces", () => {
  it("viewers, service accounts and strangers are refused; the item stays as it was", async () => {
    const before = await item(itemA);
    for (const who of [viewer, service, otherTenantUser]) expect(await errorCode(pull(who, itemA, { summary: "nope" })), who).toBe(DENIED);
    expect(await item(itemA)).toEqual(before);
  });
  it("a creator of workspace A cannot pull into, or record a base for, an item of workspace B", async () => {
    const before = await item(itemB);
    expect(await errorCode(pull(creator, itemB, { summary: "cross" }))).toBe(DENIED);
    expect(await errorCode(record(creator, itemB, { title: H("c") }))).toBe(DENIED);
    expect(await item(itemB)).toEqual(before);
    expect((await link(itemB)).sync_base).toBeNull();
  });
  it("the functions are not callable by signed-in users directly", async () => {
    const r = await db.asUser(creator, (q) => q("select public.github_apply_pull($1, $2, '{\"summary\":\"x\"}'::jsonb, null)", [creator, itemA])).then(() => "ran", (e: { code?: string }) => e.code);
    expect(r).toBe(DENIED);
  });
});

describe("sync_base holds hashes only", () => {
  it("record merges keys, stamps the check, and rejects anything that is not a sha256 of a known field", async () => {
    await record(creator, itemA, { summary: H("d") });
    const l = await link(itemA);
    expect(l.sync_base).toMatchObject({ title: H("a"), summary: H("d") });
    expect(l.sync_checked_at).not.toBeNull();
    for (const bad of [{ summary: "the actual text of a summary" }, { value_12m: H("e") }, { summary: H("f").toUpperCase() }]) {
      await expect(record(creator, itemA, bad)).rejects.toBeTruthy();
    }
    expect((await link(itemA)).sync_base).toMatchObject({ summary: H("d") });
  });
  it("a follow link has no base to record", async () => {
    expect(await errorCode(record(creator, itemA2, { summary: H("a") }))).toBe("P0002");
  });
});
