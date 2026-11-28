import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Issue #746, slice 2: set the MoSCoW from the vote of a closed MoSCoW session, once, audited, undoable, by a person only.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, bot: string, items: string[];

type Change = { item: string; from: string | null; to: string; reason?: string };
const moscowOf = async (ids = items) => Object.fromEntries((await db.admin.query("select id, moscow from public.items where id = any($1::uuid[])", [ids])).rows.map((r) => [r.id as string, r.moscow as string | null]));
const setNow = (id: string, value: string | null) => db.admin.query("update public.items set moscow = $2 where id = $1", [id, value]);

/** A closed MoSCoW session over the given items with a stored result: `suggested` gives the vote's suggestion per item (must, should, could, wont). */
async function closedSession(ids: string[], suggested: Record<string, string>, method = "moscow") {
  const sid = await db.asUser(f.alice, async (q) => (await q("select public.alignment_session_create('MoSCoW apply', $1, $2::uuid[]) as id", [method, ids])).rows[0].id as string, { commit: true, via: "UI" });
  await db.asUser(f.alice, (q) => q("select public.alignment_session_set_state($1, 'open')", [sid]), { commit: true });
  await db.asUser(f.alice, (q) => q("select public.alignment_session_set_state($1, 'closed')", [sid]), { commit: true });
  const ai = (await db.admin.query("select id, item_id from public.alignment_items where session_id = $1", [sid])).rows as { id: string; item_id: string }[];
  const none = { must: 0, should: 0, could: 0, wont: 0 };
  const snapshot = { version: 1, voters: 3, invited: 3, results: { voters: 3, joint: [], groups: null, groupsNote: null, contested: [], moscow: ai.map((a) => ({ itemId: a.id, counts: none, shares: none, suggested: suggested[a.item_id], tied: false, contested: false })) } };
  await db.asService(async (q) => { await q("select public.alignment_results_store($1, $2::jsonb)", [sid, JSON.stringify(snapshot)]); }, { commit: true });
  return sid;
}
const apply = (user: string, sid: string, changes: unknown, scope = "all", opts: { via?: string } = { via: "UI" }) =>
  db.asUser(user, async (q) => (await q("select public.alignment_moscow_apply($1, $2::jsonb, $3) as id", [sid, JSON.stringify(changes), scope])).rows[0].id as string, { commit: true, ...opts });
const undo = (user: string, id: string, opts: { via?: string } = { via: "UI" }) => db.asUser(user, (q) => q("select public.alignment_moscow_undo($1)", [id]), { commit: true, ...opts });

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "moscow-creator@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  bot = await createUser(db, "moscow-bot@example.test");
  await addMember(db, f.alice, f.tenantA, bot, "admin", { serviceAccount: true });
  const project = (await db.admin.query("select id from public.projects where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id;
  for (let n = 0; n < 5; n++) await db.admin.query("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, $2, $3)", [f.tenantA, `Moscow item ${n}`, project]);
  items = (await db.admin.query("select id from public.items where tenant_id = $1 and initiative_name like 'Moscow item %' order by initiative_name", [f.tenantA])).rows.map((r) => r.id);
  expect(items).toHaveLength(5);
});
afterAll(async () => { await db.close(); });

describe("setting the MoSCoW from a vote", () => {
  it("overwrites what was set before, writes only the MoSCoW field, and records who did it", async () => {
    const [a, b, c] = [items[0]!, items[1]!, items[2]!];
    await setNow(a, "Could"); await setNow(b, null); await setNow(c, "Must");
    const sid = await closedSession([a, b, c], { [a]: "should", [b]: "must", [c]: "must" });
    const t0 = (await db.admin.query("select coalesce(max(id), 0) as m from public.audit_log")).rows[0].m;
    const app = await apply(f.alice, sid, [{ item: a, from: "Could", to: "Should" }, { item: b, from: null, to: "Must" }, { item: c, from: "Must", to: "Must" }]);
    expect(await moscowOf([a, b, c])).toEqual({ [a]: "Should", [b]: "Must", [c]: "Must" });
    const row = (await db.admin.query("select * from public.alignment_moscow_applications where id = $1", [app])).rows[0];
    expect(row).toMatchObject({ session_id: sid, tenant_id: f.tenantA, scope: "all", changed: 2, created_by: f.alice, created_via: "UI", undone_at: null }); // the unchanged one is not recorded
    const rows = (await db.admin.query("select entity, entity_id, field, actor_id, via from public.audit_log where id > $1 and entity in ('items', 'alignment_sessions') order by id", [t0])).rows;
    // only the MoSCoW changes; the "last edited" stamps are what every ordinary edit of an initiative records
    expect([...new Set(rows.filter((r) => r.entity === "items").map((r) => r.field))].filter((x) => x !== "last_edited_at" && x !== "last_edited_by")).toEqual(["moscow"]);
    for (const r of rows.filter((x) => x.entity === "items")) expect(r).toMatchObject({ actor_id: f.alice, via: "UI" });
    expect(rows.filter((r) => r.field === "moscow_applied")).toHaveLength(1);
    expect(rows.find((r) => r.field === "moscow_applied")).toMatchObject({ entity_id: sid, actor_id: f.alice, via: "UI" });
    await undo(f.alice, app);
  });

  it("needs a reason wherever the value differs from the vote's suggestion, worked out from the stored vote and not from the caller", async () => {
    const [a, b] = [items[0]!, items[1]!];
    await setNow(a, null); await setNow(b, null);
    const sid = await closedSession([a, b], { [a]: "must", [b]: "should" });
    expect(await errorCode(apply(f.alice, sid, [{ item: a, from: null, to: "Could" }]))).toBe("PV026");
    expect(await errorCode(apply(f.alice, sid, [{ item: a, from: null, to: "Could", reason: "   " }]))).toBe("PV026");
    expect(await errorCode(apply(f.alice, sid, [{ item: a, from: null, to: "Could", reason: "x".repeat(301) }]))).toBe("PV026");
    expect(await moscowOf([a])).toEqual({ [a]: null }); // nothing changed
    const app = await apply(f.alice, sid, [{ item: a, from: null, to: "Could", reason: "  Not   this quarter " }, { item: b, from: null, to: "Should" }]);
    const changes = (await db.admin.query("select changes from public.alignment_moscow_applications where id = $1", [app])).rows[0].changes as Change[];
    expect(changes.find((c) => c.item === a)).toMatchObject({ to: "Could", suggested: "Must", reason: "Not this quarter" });
    expect(changes.find((c) => c.item === b)!.reason).toBeNull(); // it follows the vote: no reason stored
    await undo(f.alice, app);
  });

  it("undo restores the earlier values exactly, including empty ones, and only once", async () => {
    const ids = [items[0]!, items[1]!, items[2]!];
    await setNow(ids[0]!, "Won't"); await setNow(ids[1]!, null); await setNow(ids[2]!, "Could");
    const sid = await closedSession(ids, { [ids[0]!]: "must", [ids[1]!]: "must", [ids[2]!]: "should" });
    const before = await moscowOf(ids);
    const app = await apply(f.alice, sid, [{ item: ids[0]!, from: "Won't", to: "Must" }, { item: ids[1]!, from: null, to: "Must" }, { item: ids[2]!, from: "Could", to: "Should" }]);
    expect(await moscowOf(ids)).not.toEqual(before);
    await undo(f.alice, app);
    expect(await moscowOf(ids)).toEqual(before);
    expect((await db.admin.query("select undone_at, undone_by from public.alignment_moscow_applications where id = $1", [app])).rows[0]).toMatchObject({ undone_by: f.alice });
    expect(await errorCode(undo(f.alice, app))).toBe("22023");
  });

  it("refuses an undo that would overwrite a later change", async () => {
    const [a, b] = [items[0]!, items[1]!];
    await setNow(a, "Could"); await setNow(b, "Could");
    const sid = await closedSession([a, b], { [a]: "must", [b]: "must" });
    const app = await apply(f.alice, sid, [{ item: a, from: "Could", to: "Must" }, { item: b, from: "Could", to: "Must" }]);
    await setNow(b, "Should"); // someone changes it meanwhile
    expect(await errorCode(undo(f.alice, app))).toBe("PV025");
    expect(await moscowOf([a, b])).toEqual({ [a]: "Must", [b]: "Should" });
  });

  it("asks again when a value changed since the preview, and changes nothing", async () => {
    const [a, b] = [items[0]!, items[1]!];
    await setNow(a, "Could"); await setNow(b, "Could");
    const sid = await closedSession([a, b], { [a]: "must", [b]: "must" });
    await setNow(b, "Should");
    expect(await errorCode(apply(f.alice, sid, [{ item: a, from: "Could", to: "Must" }, { item: b, from: "Could", to: "Must" }]))).toBe("PV025");
    expect(await moscowOf([a, b])).toEqual({ [a]: "Could", [b]: "Should" });
  });

  it("applying twice: the second preview no longer matches, so it is refused", async () => {
    const [a] = [items[3]!];
    await setNow(a, "Could");
    const sid = await closedSession([a, items[4]!], { [a]: "must", [items[4]!]: "must" });
    const changes = [{ item: a, from: "Could", to: "Must" }];
    const app = await apply(f.alice, sid, changes);
    expect(await errorCode(apply(f.alice, sid, changes))).toBe("PV025");
    await undo(f.alice, app);
  });

  it("refuses bad values, duplicates, nothing to change, initiatives outside the session, and a session that is not a closed MoSCoW vote", async () => {
    const [a, b, outside] = [items[0]!, items[1]!, items[4]!];
    await setNow(a, null); await setNow(b, "Must"); await setNow(outside, null);
    const sid = await closedSession([a, b], { [a]: "must", [b]: "must" });
    expect(await errorCode(apply(f.alice, sid, [{ item: a, from: null, to: "Maybe" }]))).toBe("22023");
    expect(await errorCode(apply(f.alice, sid, [{ item: a, from: null, to: "must" }]))).toBe("22023"); // the field uses Must, not must
    expect(await errorCode(apply(f.alice, sid, [{ item: a, from: "Nope", to: "Must" }]))).toBe("22023");
    expect(await errorCode(apply(f.alice, sid, [{ item: a, from: null, to: "Must" }, { item: a, from: null, to: "Must" }]))).toBe("22023");
    expect(await errorCode(apply(f.alice, sid, [{ item: b, from: "Must", to: "Must" }]))).toBe("22023"); // already so
    expect(await errorCode(apply(f.alice, sid, []))).toBe("22023");
    expect(await errorCode(apply(f.alice, sid, [{ item: outside, from: null, to: "Must" }]))).toBe("22023");
    expect(await errorCode(apply(f.alice, sid, [{ item: a, from: null, to: "Must" }], "everything"))).toBe("22023");
    const coins = await closedSession([a, b], { [a]: "must", [b]: "must" }, "coins");
    expect(await errorCode(apply(f.alice, coins, [{ item: a, from: null, to: "Must" }]))).toBe("22023");
    const open = await db.asUser(f.alice, async (q) => (await q("select public.alignment_session_create('Open', 'moscow', $1::uuid[]) as id", [[a, b]])).rows[0].id as string, { commit: true, via: "UI" });
    expect(await errorCode(apply(f.alice, open, [{ item: a, from: null, to: "Must" }]))).toBe("22023");
    expect(await moscowOf([a, b, outside])).toEqual({ [a]: null, [b]: "Must", [outside]: null });
  });

  it("is for a person with admin rights only: not Claude, not a service account, not a creator, not another workspace", async () => {
    const [a, b] = [items[0]!, items[1]!];
    await setNow(a, null); await setNow(b, null);
    const sid = await closedSession([a, b], { [a]: "must", [b]: "must" });
    const changes = [{ item: a, from: null, to: "Must" }];
    expect(await errorCode(apply(f.alice, sid, changes, "selection", { via: "MCP" }))).toBe("PV004");
    expect(await errorCode(apply(bot, sid, changes))).toBe("PV004");
    expect(await errorCode(apply(creator, sid, changes))).toBe("42501");
    expect(await errorCode(apply(f.bob, sid, changes))).toBe("42501");
    expect(await moscowOf([a])).toEqual({ [a]: null });
    const app = await apply(f.alice, sid, changes, "selection");
    expect(await errorCode(undo(f.alice, app, { via: "MCP" }))).toBe("PV004");
    expect(await errorCode(undo(bot, app))).toBe("PV004");
    expect(await errorCode(undo(creator, app))).toBe("42501");
    expect(await errorCode(undo(f.bob, app))).toBe("42501");
    expect(await moscowOf([a])).toEqual({ [a]: "Must" });
    // the record, with its reasons, is for admins only
    const seen = (user: string) => db.asUser(user, async (q) => Number((await q("select count(*) as n from public.alignment_moscow_applications where session_id = $1", [sid])).rows[0].n));
    expect(await seen(f.alice)).toBe(1);
    expect(await seen(creator)).toBe(0);
    expect(await seen(f.bob)).toBe(0);
    await undo(f.alice, app);
  });
});
