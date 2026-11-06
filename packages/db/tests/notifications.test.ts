import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Gate notifications (issue #341): who is told about a request and a decision.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, approver: string, listed: string, plain: string, bot: string;
const DENIED = "42501", PV004 = "PV004";
const commit = { commit: true, via: "UI" } as const;

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "n-creator@example.test");
  approver = await createUser(db, "n-approver@example.test");
  listed = await createUser(db, "n-listed@example.test");
  plain = await createUser(db, "n-plain@example.test");
  bot = await createUser(db, "n-bot@example.test");
  for (const [u, role, extra] of [[creator, "creator", {}], [approver, "creator", {}], [listed, "creator", {}], [plain, "creator", {}], [bot, "creator", { serviceAccount: true }]] as const) await addMember(db, f.alice, f.tenantA, u, role, extra);
  await db.admin.query("update public.tenant_members set is_approver = true where tenant_id = $1 and user_id = $2", [f.tenantA, approver]);
  await db.asUser(f.alice, (q) => q("select public.set_gate_approvers($1, 'B', array[$2::uuid])", [f.tenantA, listed]), commit);
});
afterAll(async () => { await db.close(); });

const newItem = (phase = "Define") => db.admin.query("insert into public.items (tenant_id, initiative_name, home_project_id, initiative_phase) values ($1, 'Notify me', $2, $3) returning id", [f.tenantA, f.seedA.project, phase]).then((r) => r.rows[0].id as string);
const request = (user: string, item: string, gate = "B", preferred: string[] = []) =>
  db.asUser(user, async (q) => (await q("select public.request_gate($1, $2, false, '[]'::jsonb, $3::uuid[]) as id", [item, gate, preferred])).rows[0].id as string, commit);
const decide = (user: string, review: string, outcome = "go") => db.asUser(user, (q) => q("select public.decide_gate($1, $2, 'Looks right to me')", [review, outcome]), commit);
const inbox = (user: string) => db.asUser(user, async (q) => (await q("select kind, item_id, review_id, payload, read_at from public.notifications order by created_at, id")).rows as { kind: string; item_id: string; review_id: string; payload: Record<string, unknown>; read_at: string | null }[], commit);
const countFor = async (item: string) => (await db.admin.query("select user_id, kind from public.notifications where item_id = $1 order by kind", [item])).rows as { user_id: string; kind: string }[];

describe("a request tells the people who can decide it", () => {
  it("tells every Admin, Approver and listed approver of that gate, but not the requester, a plain creator or a service account", async () => {
    const item = await newItem();
    await request(creator, item);
    const to = (await countFor(item)).map((r) => r.user_id).sort();
    expect(to).toEqual([f.alice, approver, listed].sort());
    expect((await countFor(item)).every((r) => r.kind === "gate_requested")).toBe(true);
    const mine = (await inbox(listed)).filter((n) => n.item_id === item);
    expect(mine[0]).toMatchObject({ kind: "gate_requested", read_at: null, payload: { gate: "B", item_code: expect.stringMatching(/^R-/), item_name: "Notify me" } });
    expect(JSON.stringify(mine[0]!.payload)).not.toMatch(/rationale|value|confidence/i);
  });

  it("a gate's list matters only for that gate: the listed person is not told about gate A", async () => {
    const item = await newItem("Discover");
    await request(creator, item, "A");
    expect((await countFor(item)).map((r) => r.user_id).sort()).toEqual([f.alice, approver].sort());
  });

  it("the requester may name who to ask; people who cannot decide are ignored; if nobody named can decide, everyone who can is told", async () => {
    const one = await newItem();
    await request(creator, one, "B", [approver]);
    expect((await countFor(one)).map((r) => r.user_id)).toEqual([approver]);
    const two = await newItem();
    await request(creator, two, "B", [approver, plain]);
    expect((await countFor(two)).map((r) => r.user_id)).toEqual([approver]);
    const three = await newItem();
    await request(creator, three, "B", [plain]);
    expect((await countFor(three)).map((r) => r.user_id).sort()).toEqual([f.alice, approver, listed].sort());
  });

  it("an approver who requests is not told about their own request", async () => {
    const item = await newItem();
    await request(approver, item);
    expect((await countFor(item)).map((r) => r.user_id).sort()).toEqual([f.alice, listed].sort());
  });

  it("the bulk request passes the people to ask", async () => {
    const item = await newItem();
    await db.asUser(creator, (q) => q("select public.request_gates('B', $1::jsonb)", [JSON.stringify([{ item, preferred: [listed] }])]), commit);
    expect((await countFor(item)).map((r) => r.user_id)).toEqual([listed]);
  });
});

describe("a decision tells the requester and clears the request for the others", () => {
  it("tells the requester what was decided, marks the approvers' notices read, and tells nobody else", async () => {
    const item = await newItem();
    const review = await request(creator, item);
    await decide(approver, review, "go_with_conditions".replace("_with_conditions", ""));
    const rows = await countFor(item);
    expect(rows.filter((r) => r.kind === "gate_decided").map((r) => r.user_id)).toEqual([creator]);
    const mine = (await inbox(creator)).find((n) => n.item_id === item)!;
    expect(mine.payload).toMatchObject({ gate: "B", outcome: "go", fast_lane: false });
    expect(JSON.stringify(mine.payload)).not.toContain("Looks right to me"); // the rationale is read in Decisions, not copied
    const alices = (await inbox(f.alice)).find((n) => n.item_id === item)!;
    expect(alices.read_at).not.toBeNull(); // answered by someone else
  });

  it("a requester who decides their own request is not notified of it", async () => {
    const item = await newItem();
    const review = await request(approver, item);
    await decide(approver, review);
    expect((await countFor(item)).filter((r) => r.kind === "gate_decided")).toEqual([]);
  });

  it("a fast-lane decision says so, and the skipped gates it records notify nobody", async () => {
    const item = await newItem("Discover");
    const review = await request(creator, item, "B");
    await db.asUser(f.alice, (q) => q("select public.decide_gate($1, 'go', 'We know this one', true, 'Roll-out')", [review]), commit);
    const rows = await countFor(item);
    expect(rows.filter((r) => r.kind === "gate_decided")).toHaveLength(1);
    expect((await inbox(creator)).find((n) => n.item_id === item)!.payload).toMatchObject({ fast_lane: true });
    expect(rows.filter((r) => r.kind === "gate_requested").length).toBe(3); // only the one real request
  });

  it("moving the phase back withdraws the request: the requester is told, the approvers' notices are cleared", async () => {
    const item = await newItem();
    await request(creator, item);
    await db.asUser(approver, (q) => q("select public.move_phase($1, 'Discover')", [item]), commit);
    expect((await countFor(item)).filter((r) => r.kind === "gate_withdrawn").map((r) => r.user_id)).toEqual([creator]);
    expect((await inbox(listed)).find((n) => n.item_id === item)!.read_at).not.toBeNull();
  });
});

describe("the inbox is private and written only by the database", () => {
  it("shows a member only their own rows, never another workspace's or another person's", async () => {
    const item = await newItem();
    await request(creator, item);
    expect((await inbox(creator)).filter((n) => n.item_id === item)).toEqual([]); // the requester was not told of their own request
    expect((await inbox(plain)).filter((n) => n.item_id === item)).toEqual([]);
    expect((await inbox(f.bob)).filter((n) => n.item_id === item)).toEqual([]);
  });

  it("cannot be written, edited or deleted from the API", async () => {
    const item = await newItem();
    await request(creator, item);
    for (const sql of [
      "insert into public.notifications (tenant_id, user_id, kind, payload) values ($1, $2, 'gate_decided', '{}')",
      "update public.notifications set read_at = now()",
      "delete from public.notifications",
    ]) expect(await errorCode(db.asUser(approver, (q) => q(sql, sql.startsWith("insert") ? [f.tenantA, approver] : []), commit)), sql).toBe(DENIED);
  });

  it("marks only the caller's own notifications read, one list or all, and never for Claude or a service account", async () => {
    const item = await newItem();
    await request(creator, item);
    const mine = (await inbox(approver)).filter((n) => n.read_at === null);
    expect(mine.length).toBeGreaterThan(1);
    const first = (await db.admin.query("select id from public.notifications where user_id = $1 and read_at is null limit 1", [approver])).rows[0].id as string;
    expect(await db.asUser(approver, async (q) => (await q("select public.mark_notifications_read($1::uuid[]) as n", [[first]])).rows[0].n, commit)).toBe(1);
    const aliceUnread = Number((await db.admin.query("select count(*) from public.notifications where user_id = $1 and read_at is null", [f.alice])).rows[0].count);
    expect(aliceUnread).toBeGreaterThan(0); // someone else's rows are untouched
    await db.asUser(approver, (q) => q("select public.mark_notifications_read()"), commit);
    expect(Number((await db.admin.query("select count(*) from public.notifications where user_id = $1 and read_at is null", [approver])).rows[0].count)).toBe(0);
    expect(Number((await db.admin.query("select count(*) from public.notifications where user_id = $1 and read_at is null", [f.alice])).rows[0].count)).toBe(aliceUnread);
    expect(await errorCode(db.asUser(approver, (q) => q("select public.mark_notifications_read()"), { commit: true, via: "MCP" }))).toBe(PV004);
    expect(await errorCode(db.asUser(bot, (q) => q("select public.mark_notifications_read()"), commit))).toBe(null); // nothing of theirs to mark: a service account has none
  });

  it("goes with the initiative when it is purged", async () => {
    const item = await newItem();
    await request(creator, item);
    await db.admin.query("delete from public.items where id = $1", [item]);
    expect((await countFor(item))).toEqual([]);
  });
});
