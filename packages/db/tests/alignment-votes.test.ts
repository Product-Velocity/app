import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let items: string[];
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

/** A session with the given method, open, with one consenting participant. Returns the ids needed. */
async function setup(method: "top5_duels" | "coins" | "ice", nItems = 3, consent = true) {
  const sid = await db.asUser(f.alice, async (q) => (await q("select public.alignment_session_create('S', $1, $2::uuid[]) as id", [method, items.slice(0, nItems)])).rows[0].id as string, { commit: true, via: "UI" });
  await db.asUser(f.alice, (q) => q("select public.alignment_session_configure($1, 'S', $2, '[{\"id\":\"all\",\"name\":\"All\"}]'::jsonb, 'equal', '{}', 100, 30, false, 12, null)", [sid, method]), { commit: true });
  await db.asUser(f.alice, (q) => q("select public.alignment_session_set_state($1, 'open')", [sid]), { commit: true });
  await db.asUser(f.alice, (q) => q("select public.alignment_participants_add($1, '[{\"email\":\"v@example.test\",\"group\":\"all\"}]'::jsonb)", [sid]), { commit: true });
  const pid = (await db.admin.query("select id from public.alignment_participants where session_id = $1", [sid])).rows[0].id as string;
  if (consent) await db.admin.query("update public.alignment_participants set consent_at = now(), token_hash = $2 where id = $1", [pid, hash(`t-${pid}`)]);
  const ai = (await db.admin.query("select id from public.alignment_items where session_id = $1 order by position", [sid])).rows.map((r) => r.id as string);
  return { sid, pid, ai };
}
const svc = <T>(fn: (q: (sql: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>) => db.asService(fn as never, { commit: true }) as Promise<T>;
const get = (pid: string) => svc(async (q) => (await q("select * from public.alignment_ballot_get($1)", [pid])).rows[0]);
const save = (pid: string, progress: unknown, rev: number) => svc(async (q) => (await q("select public.alignment_ballot_save($1, $2::jsonb, $3) as r", [pid, JSON.stringify(progress), rev])).rows[0]!.r as number);
const submit = (pid: string, answers: unknown, rev = 1) => svc((q) => q("select public.alignment_ballot_submit($1, $2::jsonb, $3)", [pid, JSON.stringify(answers), rev]));
const votes = async (sid: string) => (await db.admin.query("select * from public.alignment_votes where session_id = $1 order by alignment_item_id", [sid])).rows;

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  const project = (await db.admin.query("select id from public.projects where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id;
  for (let n = 0; n < 8; n++) await db.admin.query("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, $2, $3)", [f.tenantA, `Vote item ${n}`, project]);
  items = (await db.admin.query("select id from public.items where tenant_id = $1 and deleted_at is null order by stack_rank limit 8", [f.tenantA])).rows.map((r) => r.id);
  expect(items).toHaveLength(8);
});
afterAll(async () => { await db.close(); });

describe("the ballot", () => {
  it("is made on first use, and only for someone who consented", async () => {
    const a = await setup("coins", 3, false);
    expect(await errorCode(get(a.pid))).toBe("PV011");
    const b = await setup("coins");
    const ballot = await get(b.pid);
    expect(ballot).toMatchObject({ state: "in_progress", revision: 0 });
    expect((await get(b.pid)).ballot_id).toBe(ballot.ballot_id);
  });
  it("never goes backwards: an older save is ignored, a newer one is kept", async () => {
    const { pid } = await setup("coins");
    await get(pid);
    expect(await save(pid, { step: 2 }, 2)).toBe(2);
    expect(await save(pid, { step: 1 }, 1)).toBe(2);
    expect(await save(pid, { step: 2 }, 2)).toBe(2);
    expect((await get(pid)).progress).toEqual({ step: 2 });
  });
  it("is closed to saves and votes once the session closes, and to a removed person", async () => {
    const { sid, pid } = await setup("coins");
    await get(pid);
    await db.asUser(f.alice, (q) => q("select public.alignment_session_set_state($1, 'closed')", [sid]), { commit: true });
    expect(await errorCode(save(pid, {}, 1))).toBe("22023");
    expect(await errorCode(submit(pid, { coins: {} }))).toBe("22023");
    const other = await setup("coins");
    await db.asUser(f.alice, (q) => q("select public.alignment_participant_remove($1)", [other.pid]), { commit: true });
    expect(await errorCode(get(other.pid))).toBe("22023");
  });
});

describe("the three methods", () => {
  it("coins: all coins spent, at most 30 on one initiative, only this session's initiatives; the same answers twice change nothing", async () => {
    const { sid, pid, ai } = await setup("coins");
    await get(pid);
    expect(await errorCode(submit(pid, { coins: { [ai[0]!]: 31, [ai[1]!]: 69 } }))).toBe("22023");
    expect(await errorCode(submit(pid, { coins: { [ai[0]!]: 30, [ai[1]!]: 30 } }))).toBe("22023"); // 60 spent
    expect(await errorCode(submit(pid, { coins: { [ai[0]!]: 30, [ai[1]!]: 30, "00000000-0000-0000-0000-000000000000": 40 } }))).toBe("22023");
    const ok = { coins: { [ai[0]!]: 30, [ai[1]!]: 30, [ai[2]!]: 40 } };
    expect(await errorCode(submit(pid, ok))).toBe("22023"); // 40 on one
    const good = { coins: { [ai[0]!]: 30, [ai[1]!]: 30, [ai[2]!]: 30 } };
    expect(await errorCode(submit(pid, good))).toBe("22023"); // 90, not 100
    expect(await votes(sid)).toHaveLength(0);
    // five items: 30 + 30 + 20 + 10 + 10 = 100
    const big = await setup("coins", 5);
    await get(big.pid);
    const answers = { coins: { [big.ai[0]!]: 30, [big.ai[1]!]: 30, [big.ai[2]!]: 20, [big.ai[3]!]: 10, [big.ai[4]!]: 10 } };
    await submit(big.pid, answers);
    await submit(big.pid, answers);
    const v = await votes(big.sid);
    expect(v).toHaveLength(5);
    expect(v.reduce((n, x) => n + Number(x.coins), 0)).toBe(100);
    expect((await get(big.pid)).state).toBe("submitted");
  });
  it("a changed vote replaces the earlier one; the number of rows stays the same", async () => {
    const { sid, pid, ai } = await setup("coins", 4);
    await get(pid);
    await submit(pid, { coins: { [ai[0]!]: 30, [ai[1]!]: 30, [ai[2]!]: 30, [ai[3]!]: 10 } });
    await submit(pid, { coins: { [ai[0]!]: 10, [ai[1]!]: 30, [ai[2]!]: 30, [ai[3]!]: 30 } }, 2);
    const v = await votes(sid);
    expect(v).toHaveLength(4);
    expect(v.map((x) => Number(x.coins)).sort((a, b) => a - b)).toEqual([10, 30, 30, 30]);
  });
  it("top 5 with duels: exactly five distinct initiatives, in order; with fewer than five items all are ranked", async () => {
    const { sid, pid, ai } = await setup("top5_duels", 7);
    await get(pid);
    expect(await errorCode(submit(pid, { ranking: ai.slice(0, 4) }))).toBe("22023");
    expect(await errorCode(submit(pid, { ranking: [ai[0], ai[0], ai[1], ai[2], ai[3]] }))).toBe("22023");
    await submit(pid, { ranking: [ai[3], ai[1], ai[0], ai[6], ai[2]] });
    const v = await votes(sid);
    expect(v).toHaveLength(7);
    const rank = Object.fromEntries(v.map((x) => [x.alignment_item_id, x.rank]));
    expect(rank[ai[3]!]).toBe(1);
    expect(rank[ai[2]!]).toBe(5);
    expect(rank[ai[4]!]).toBeNull();
    const small = await setup("top5_duels", 3);
    await get(small.pid);
    await submit(small.pid, { ranking: [small.ai[2], small.ai[0], small.ai[1]] });
    expect((await votes(small.sid)).map((x) => x.rank).sort()).toEqual([1, 2, 3]);
  });
  it("ICE: every initiative scored 1 to 10 on impact, confidence and ease", async () => {
    const { sid, pid, ai } = await setup("ice", 2);
    await get(pid);
    const score = (n: number) => ({ impact: n, confidence: n, ease: n });
    expect(await errorCode(submit(pid, { ice: { [ai[0]!]: score(5) } }))).toBe("22023");
    expect(await errorCode(submit(pid, { ice: { [ai[0]!]: score(5), [ai[1]!]: { impact: 11, confidence: 1, ease: 1 } } }))).toBe("22023");
    await submit(pid, { ice: { [ai[0]!]: score(8), [ai[1]!]: { impact: 3, confidence: 9, ease: 10 } } });
    const v = await votes(sid);
    expect(v.map((x) => [x.impact, x.confidence, x.ease])).toEqual(expect.arrayContaining([[8, 8, 8], [3, 9, 10]]));
  });
  it("audit entries of a ballot carry the state only, never which participant owns it or what was answered", async () => {
    const { sid, pid, ai } = await setup("coins", 4);
    const ballot = await get(pid);
    await submit(pid, { coins: { [ai[0]!]: 30, [ai[1]!]: 30, [ai[2]!]: 30, [ai[3]!]: 10 } });
    const rows = (await db.admin.query("select field, new from public.audit_log where entity = 'alignment_ballots' and entity_id = $1", [ballot.ballot_id])).rows;
    expect(rows.map((r) => r.field).sort()).toEqual(["state", "state", "submitted_at"]);
    expect(JSON.stringify(rows)).not.toMatch(/participant|coins/);
    expect((await db.admin.query("select count(*)::int as n from public.audit_log where entity = 'alignment_votes'")).rows[0].n).toBe(0);
    void sid;
  });
});

describe("results and names", () => {
  const store = (sid: string, snap: unknown) => svc(async (q) => (await q("select public.alignment_results_store($1, $2::jsonb) as r", [sid, JSON.stringify(snap)])).rows[0]!.r as boolean);
  it("the results are stored once, only for a closed session, and never change", async () => {
    const { sid } = await setup("coins");
    expect(await errorCode(store(sid, { joint: [] }))).toBe("22023");
    await db.asUser(f.alice, (q) => q("select public.alignment_session_set_state($1, 'closed')", [sid]), { commit: true });
    expect(await store(sid, { joint: [1] })).toBe(true);
    expect(await store(sid, { joint: [2] })).toBe(false);
    expect((await db.admin.query("select results_snapshot from public.alignment_sessions where id = $1", [sid])).rows[0].results_snapshot).toEqual({ joint: [1] });
    expect(await errorCode(db.admin.query("update public.alignment_sessions set results_snapshot = '{}' where id = $1", [sid]))).toBe("PV009");
    expect(await errorCode(db.admin.query("update public.alignment_sessions set results_snapshot = null where id = $1", [sid]))).toBe("PV009");
  });
  it("Show names needs a reason, an admin and a person; it is logged before the names come back, and it is not a ranked list", async () => {
    const { sid, pid, ai } = await setup("coins", 4);
    await get(pid);
    await submit(pid, { coins: { [ai[0]!]: 30, [ai[1]!]: 30, [ai[2]!]: 30, [ai[3]!]: 10 } });
    const reveal = (user: string, reason: string, via = "UI") => db.asUser(user, async (q) => (await q("select * from public.alignment_reveal_names($1, $2)", [sid, reason])).rows, { commit: true, via });
    expect(await errorCode(reveal(f.alice, "no"))).toBe("22023");
    expect(await errorCode(reveal(f.bob, "Checking a complaint"))).toBe("42501");
    expect(await errorCode(reveal(f.alice, "Checking a complaint", "Claude MCP"))).toBe("PV004");
    expect((await db.admin.query("select count(*)::int as n from public.audit_log where entity_id = $1 and field = 'names_revealed'", [sid])).rows[0].n).toBe(0);
    const rows = await reveal(f.alice, "Checking a complaint from sales");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "v@example.test", voted: true });
    expect((rows[0].answers as { item: string; coins: number }[]).map((a) => a.coins)).toEqual([30, 30, 30, 10]);
    const log = (await db.admin.query("select actor_id, new, via from public.audit_log where entity_id = $1 and field = 'names_revealed'", [sid])).rows;
    expect(log).toEqual([{ actor_id: f.alice, new: "Checking a complaint from sales", via: "UI" }]);
  });
});
