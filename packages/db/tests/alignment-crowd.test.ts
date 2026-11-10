import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, twoTenantFixture, type TestDb } from "./helpers";

// Issue #393: item_alignment_results() reads what the crowd said about an initiative from the stored snapshot of closed sessions.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let member: string, items: string[];

/** A closed session over the first three items with a hand-made snapshot (the scoring itself is tested in @pv/domain). */
async function closedSession(opts: { show: boolean; closedAt: string; snapshot?: (ai: string[]) => unknown; keepOpen?: boolean }) {
  const sid = await db.asUser(f.alice, async (q) => (await q("select public.alignment_session_create('Crowd', 'coins', $1::uuid[]) as id", [items.slice(0, 3)])).rows[0].id as string, { commit: true, via: "UI" });
  await db.asUser(f.alice, (q) => q("select public.alignment_session_configure($1, 'Crowd', 'coins', '[{\"id\":\"all\",\"name\":\"All\"}]'::jsonb, 'equal', '{}', 100, 30, $2, 12, null)", [sid, opts.show]), { commit: true });
  await db.asUser(f.alice, (q) => q("select public.alignment_session_set_state($1, 'open')", [sid]), { commit: true });
  const ai = (await db.admin.query("select id from public.alignment_items where session_id = $1 order by position", [sid])).rows.map((r) => r.id as string);
  if (opts.keepOpen) return { sid, ai };
  await db.asUser(f.alice, (q) => q("select public.alignment_session_set_state($1, 'closed')", [sid]), { commit: true });
  const snap = opts.snapshot?.(ai) ?? defaultSnapshot(ai);
  await db.asService(async (q) => { await q("select public.alignment_results_store($1, $2::jsonb)", [sid, JSON.stringify(snap)]); }, { commit: true });
  await db.admin.query("update public.alignment_sessions set closed_at = $2 where id = $1", [sid, opts.closedAt]);
  return { sid, ai };
}
const defaultSnapshot = (ai: string[]) => ({
  version: 1, voters: 12, invited: 14,
  results: {
    voters: 12,
    joint: [{ itemId: ai[0], score: 100, place: 1, tied: false }, { itemId: ai[1], score: 71.4, place: 2, tied: true }, { itemId: ai[2], score: 71.4, place: 2, tied: true }],
    groups: [
      { id: "s", name: "Sales", voters: 6, scores: [{ itemId: ai[0], score: 100, place: 1, tied: false }, { itemId: ai[1], score: 60, place: 2, tied: false }, { itemId: ai[2], score: 10, place: 3, tied: false }] },
      { id: "e", name: "Engineering", voters: 6, scores: [{ itemId: ai[0], score: 90, place: 1, tied: false }, { itemId: ai[1], score: 100, place: 1, tied: false }, { itemId: ai[2], score: 70, place: 2, tied: false }] },
    ],
    groupsNote: null,
    contested: [{ itemId: ai[2], spread: 60, highGroup: "Engineering", lowGroup: "Sales" }],
  },
});
const read = (user: string, tenant: string, item: string | null) =>
  db.asUser(user, async (q) => (await q("select * from public.item_alignment_results($1, $2) order by closed_at desc", [tenant, item])).rows);

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  member = await createUser(db, "crowd-member@example.test");
  await addMember(db, f.alice, f.tenantA, member, "creator");
  const project = (await db.admin.query("select id from public.projects where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id;
  for (let n = 0; n < 3; n++) await db.admin.query("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, $2, $3)", [f.tenantA, `Crowd item ${n}`, project]);
  items = (await db.admin.query("select id from public.items where tenant_id = $1 and initiative_name like 'Crowd item %' order by initiative_name", [f.tenantA])).rows.map((r) => r.id);
});
afterAll(async () => { await db.close(); });

describe("item_alignment_results", () => {
  it("gives an admin place, score, ties, contest, consensus and the total of voters for a closed session", async () => {
    const { sid } = await closedSession({ show: false, closedAt: "2027-01-10T10:00:00Z" });
    const rows = await read(f.alice, f.tenantA, items[0]!);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ item_id: items[0], session_id: sid, session_name: "Crowd", method: "coins", place: 1, tied: false, of_items: 3, voters: 12, contested: false, high_group: null });
    expect(Number(rows[0].score)).toBe(100);
    expect(Number(rows[0].consensus)).toBe(90); // groups rate it 100 and 90
    const tied = (await read(f.alice, f.tenantA, items[1]!))[0];
    expect(tied).toMatchObject({ place: 2, tied: true });
    const contested = (await read(f.alice, f.tenantA, items[2]!))[0];
    expect(contested).toMatchObject({ contested: true, high_group: "Engineering", low_group: "Sales" });
    expect(Number(contested.spread)).toBe(60);
    expect(Number(contested.consensus)).toBe(40);
  });

  it("shows other members a result only when the session lets participants see results", async () => {
    await closedSession({ show: false, closedAt: "2027-01-11T10:00:00Z" });
    const hidden = await read(member, f.tenantA, items[0]!);
    expect(hidden.every((r) => r.session_name !== undefined)).toBe(true);
    const before = hidden.length;
    await closedSession({ show: true, closedAt: "2027-01-12T10:00:00Z" });
    expect((await read(member, f.tenantA, items[0]!)).length).toBe(before + 1);
    // the admin sees all sessions, the member only the allowed ones
    const adminCount = (await read(f.alice, f.tenantA, items[0]!)).length;
    expect(adminCount).toBeGreaterThan(before + 1);
  });

  it("lists every closed session of the item newest first, so history is kept", async () => {
    const rows = await read(f.alice, f.tenantA, items[0]!);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const times = rows.map((r) => new Date(r.closed_at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("gives nothing for a draft or an open session", async () => {
    const before = (await read(f.alice, f.tenantA, null)).length;
    await closedSession({ show: true, closedAt: "2027-02-01T10:00:00Z", keepOpen: true });
    expect((await read(f.alice, f.tenantA, null)).length).toBe(before);
  });

  it("has no consensus when the snapshot shows no groups, and never a group name that was not stored", async () => {
    const { ai } = await closedSession({
      show: false, closedAt: "2027-03-01T10:00:00Z",
      snapshot: (a) => ({ version: 1, voters: 4, invited: 4, results: { voters: 4, joint: [{ itemId: a[0], score: 100, place: 1, tied: false }, { itemId: a[1], score: 50, place: 2, tied: false }, { itemId: a[2], score: 0, place: 3, tied: false }], groups: null, groupsNote: "Groups with fewer than 5 voters are not shown on their own.", contested: [] } }),
    });
    const r = (await read(f.alice, f.tenantA, items[0]!))[0];
    expect(ai).toHaveLength(3);
    expect(r).toMatchObject({ voters: 4, consensus: null, contested: false, high_group: null, low_group: null });
  });

  it("is limited to the workspace asked for and to its members", async () => {
    expect(await read(f.bob, f.tenantA, null)).toEqual([]); // another workspace's admin
    expect(await read(f.alice, f.tenantB, null)).toEqual([]); // not a member of that workspace
    expect(await read(f.bob, f.tenantB, items[0]!)).toEqual([]); // an initiative of another workspace
  });

  it("returns aggregates only: no email, participant, ballot or person column", async () => {
    const cols = (await db.asUser(f.alice, async (q) => (await q("select * from public.item_alignment_results($1, null) limit 1", [f.tenantA])).fields.map((x) => x.name))) as string[];
    expect(cols.length).toBeGreaterThan(10);
    for (const c of cols) expect(c, c).not.toMatch(/email|participant|ballot|voter_id|user/);
    expect(cols).toContain("voters"); // a total only
  });
});
