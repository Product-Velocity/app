import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Issue #394: apply the vote of a closed session to the Stack Rank, once, audited, undoable, by a person only.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, bot: string, items: string[];

type Move = { item: string; from: number; to: number };
const ranks = async (ids = items) => Object.fromEntries((await db.admin.query("select id, stack_rank, previous_rank from public.items where id = any($1::uuid[])", [ids])).rows.map((r) => [r.id, { rank: r.stack_rank as number, prev: r.previous_rank as number | null }]));
const allRanks = async () => (await db.admin.query("select id, stack_rank from public.items where tenant_id = $1 and deleted_at is null and cycle_id is null order by stack_rank", [f.tenantA])).rows.map((r) => `${r.id}:${r.stack_rank}`);

/** A closed session over the given items with a stored snapshot. */
async function closedSession(ids = items.slice(0, 4)) {
  const sid = await db.asUser(f.alice, async (q) => (await q("select public.alignment_session_create('Rank apply', 'coins', $1::uuid[]) as id", [ids])).rows[0].id as string, { commit: true, via: "UI" });
  await db.asUser(f.alice, (q) => q("select public.alignment_session_set_state($1, 'open')", [sid]), { commit: true });
  await db.asUser(f.alice, (q) => q("select public.alignment_session_set_state($1, 'closed')", [sid]), { commit: true });
  await db.asService(async (q) => { await q("select public.alignment_results_store($1, $2::jsonb)", [sid, JSON.stringify({ version: 1, voters: 5, invited: 5, results: { voters: 5, joint: [], groups: null, groupsNote: null, contested: [] } })]); }, { commit: true });
  return sid;
}
/** Reverses the order of the given items among the positions they hold (the vote prefers the last over the first, and so on). */
async function reverseMoves(ids: string[]): Promise<Move[]> {
  const r = await ranks(ids);
  const sorted = [...ids].sort((a, b) => r[a]!.rank - r[b]!.rank);
  return sorted.map((id, i) => ({ item: id, from: r[id]!.rank, to: r[sorted[sorted.length - 1 - i]!]!.rank }));
}
const apply = (user: string, sid: string, moves: unknown, scope = "all", opts: { via?: string } = { via: "UI" }) =>
  db.asUser(user, async (q) => (await q("select public.alignment_rank_apply($1, $2::jsonb, $3) as id", [sid, JSON.stringify(moves), scope])).rows[0].id as string, { commit: true, ...opts });
const undo = (user: string, id: string, opts: { via?: string } = { via: "UI" }) => db.asUser(user, (q) => q("select public.alignment_rank_undo($1)", [id]), { commit: true, ...opts });

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "rank-creator@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  bot = await createUser(db, "rank-bot@example.test");
  await addMember(db, f.alice, f.tenantA, bot, "admin", { serviceAccount: true });
  const project = (await db.admin.query("select id from public.projects where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id;
  for (let n = 0; n < 6; n++) await db.admin.query("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, $2, $3)", [f.tenantA, `Rank item ${n}`, project]);
  items = (await db.admin.query("select id from public.items where tenant_id = $1 and initiative_name like 'Rank item %' order by stack_rank", [f.tenantA])).rows.map((r) => r.id);
  expect(items).toHaveLength(6);
});
afterAll(async () => { await db.close(); });

describe("applying a vote to the Stack Rank", () => {
  it("reorders the positions the voted initiatives hold, changes nothing else, and records it", async () => {
    const sid = await closedSession([items[0]!, items[2]!, items[5]!]);
    const before = await allRanks();
    const moves = await reverseMoves([items[0]!, items[2]!, items[5]!]);
    const app = await apply(f.alice, sid, moves, "selection");
    const after = await ranks();
    expect(after[items[0]!]!.rank).toBe(moves[0]!.to);
    expect(after[items[5]!]!.rank).toBe(moves[0]!.from); // swapped with the first
    expect(after[items[0]!]!.prev).toBe(moves[0]!.from); // Previous Rank is kept
    expect(after[items[1]!]!.rank).toBe(await ranks([items[1]!]).then((r) => r[items[1]!]!.rank)); // an initiative outside the vote did not move
    const now = await allRanks();
    expect(now.filter((x) => !before.includes(x)).length).toBe(2); // the middle one stays: two initiatives changed
    const row = (await db.admin.query("select * from public.alignment_rank_applications where id = $1", [app])).rows[0];
    expect(row).toMatchObject({ session_id: sid, tenant_id: f.tenantA, scope: "selection", moved: 2, created_by: f.alice, created_via: "UI", undone_at: null });
    // ranks stay one to N with no gap or duplicate
    const all = (await db.admin.query("select stack_rank from public.items where tenant_id = $1 and deleted_at is null and cycle_id is null order by stack_rank", [f.tenantA])).rows.map((r) => r.stack_rank);
    expect(all).toEqual(all.map((_, i) => i + 1));
    await undo(f.alice, app);
  });

  it("writes only stack_rank and previous_rank, with the person and the source in the audit log, plus one entry on the session", async () => {
    const ids = [items[1]!, items[3]!];
    const sid = await closedSession(ids);
    const t0 = (await db.admin.query("select coalesce(max(id), 0) as m from public.audit_log")).rows[0].m;
    const app = await apply(f.alice, sid, await reverseMoves(ids));
    const rows = (await db.admin.query("select entity, entity_id, field, actor_id, via from public.audit_log where id > $1 order by id", [t0])).rows;
    const itemFields = new Set(rows.filter((r) => r.entity === "items").map((r) => r.field));
    expect([...itemFields].sort()).toEqual(["previous_rank", "stack_rank"]);
    for (const r of rows.filter((x) => x.entity === "items")) expect(r).toMatchObject({ actor_id: f.alice, via: "UI" });
    expect(rows.filter((r) => r.entity === "alignment_sessions" && r.field === "rank_applied")).toHaveLength(1);
    expect(rows.find((r) => r.field === "rank_applied")).toMatchObject({ entity_id: sid, actor_id: f.alice, via: "UI" });
    await undo(f.alice, app);
  });

  it("undo restores the previous order exactly, including Previous Rank, and only once", async () => {
    const ids = [items[0]!, items[1]!, items[2]!, items[3]!];
    const sid = await closedSession(ids);
    const order = await allRanks();
    const prev = await ranks(ids);
    const app = await apply(f.alice, sid, await reverseMoves(ids));
    expect(await allRanks()).not.toEqual(order);
    await undo(f.alice, app);
    expect(await allRanks()).toEqual(order);
    expect(await ranks(ids)).toEqual(prev);
    expect((await db.admin.query("select undone_at, undone_by from public.alignment_rank_applications where id = $1", [app])).rows[0]).toMatchObject({ undone_by: f.alice });
    expect(await errorCode(undo(f.alice, app))).toBe("22023");
  });

  it("refuses an undo that would overwrite a later change", async () => {
    const ids = [items[0]!, items[1]!];
    const sid = await closedSession(ids);
    const app = await apply(f.alice, sid, await reverseMoves(ids));
    await db.asUser(f.alice, (q) => q("select public.move_item($1, 1)", [items[3]!]), { commit: true, via: "UI" }); // someone re-ranks meanwhile
    expect(await errorCode(undo(f.alice, app))).toBe("PV025");
    // put the order back by hand so later tests start from a known state
    await db.asUser(f.alice, (q) => q("select public.move_item($1, $2)", [items[3]!, 4]), { commit: true, via: "UI" });
  });

  it("asks again when the rank changed since the preview, and changes nothing", async () => {
    const ids = [items[0]!, items[1]!];
    const sid = await closedSession(ids);
    const moves = await reverseMoves(ids);
    const before = await allRanks();
    await db.asUser(f.alice, (q) => q("select public.move_item($1, 1)", [items[4]!]), { commit: true, via: "UI" });
    const changed = await allRanks();
    expect(await errorCode(apply(f.alice, sid, moves))).toBe("PV025");
    expect(await allRanks()).toEqual(changed);
    expect(changed).not.toEqual(before);
  });

  it("applying twice: the second preview no longer matches, so it is refused instead of silently overwriting", async () => {
    const ids = [items[2]!, items[3]!];
    const sid = await closedSession(ids);
    const moves = await reverseMoves(ids);
    const app = await apply(f.alice, sid, moves);
    expect(await errorCode(apply(f.alice, sid, moves))).toBe("PV025");
    await undo(f.alice, app);
  });

  it("refuses moves that are not a reorder of the positions held, duplicates, and nothing to change", async () => {
    const ids = [items[0]!, items[1]!];
    const sid = await closedSession(ids);
    const [a, b] = await reverseMoves(ids);
    const r = await ranks(ids);
    expect(await errorCode(apply(f.alice, sid, [{ item: a!.item, from: a!.from, to: 99 }, { item: b!.item, from: b!.from, to: a!.from }]))).toBe("22023"); // takes a position nobody gave up
    expect(await errorCode(apply(f.alice, sid, [{ item: a!.item, from: a!.from, to: a!.from }, { item: b!.item, from: b!.from, to: a!.from }]))).toBe("22023"); // two on one position
    expect(await errorCode(apply(f.alice, sid, [a, a]))).toBe("22023"); // listed twice
    expect(await errorCode(apply(f.alice, sid, [a]))).toBe("22023"); // one initiative cannot be reordered
    expect(await errorCode(apply(f.alice, sid, [{ ...a, to: a!.from }, { ...b, to: b!.from }]))).toBe("22023"); // already in vote order
    expect(await ranks(ids)).toEqual(r);
  });

  it("refuses an initiative that is not in the session, a trashed one, and a session without final results", async () => {
    const sid = await closedSession([items[0]!, items[1]!]);
    const out = await reverseMoves([items[0]!, items[4]!]);
    expect(await errorCode(apply(f.alice, sid, out))).toBe("22023"); // items[4] is not in this session
    const open = await db.asUser(f.alice, async (q) => (await q("select public.alignment_session_create('Open', 'coins', $1::uuid[]) as id", [[items[0]!, items[1]!]])).rows[0].id as string, { commit: true, via: "UI" });
    expect(await errorCode(apply(f.alice, open, await reverseMoves([items[0]!, items[1]!])))).toBe("22023"); // still a draft
    await db.admin.query("update public.items set deleted_at = now() where id = $1", [items[1]!]);
    expect(await errorCode(apply(f.alice, sid, await reverseMoves([items[0]!, items[1]!])))).toBe("22023");
    await db.admin.query("update public.items set deleted_at = null where id = $1", [items[1]!]);
  });

  it("is for a person with admin rights only: not Claude, not a service account, not a creator, not another workspace", async () => {
    const ids = [items[0]!, items[1]!];
    const sid = await closedSession(ids);
    const moves = await reverseMoves(ids);
    const before = await allRanks();
    expect(await errorCode(apply(f.alice, sid, moves, "all", { via: "MCP" }))).toBe("PV004"); // an admin's session through Claude
    expect(await errorCode(apply(bot, sid, moves))).toBe("PV004"); // a service account, even an admin one
    expect(await errorCode(apply(creator, sid, moves))).toBe("42501");
    expect(await errorCode(apply(f.bob, sid, moves))).toBe("42501");
    expect(await allRanks()).toEqual(before);
    const app = await apply(f.alice, sid, moves);
    expect(await errorCode(undo(f.alice, app, { via: "MCP" }))).toBe("PV004");
    expect(await errorCode(undo(bot, app))).toBe("PV004");
    expect(await errorCode(undo(creator, app))).toBe("42501");
    expect(await errorCode(undo(f.bob, app))).toBe("42501");
    await undo(f.alice, app);
  });

  it("the table can be read by members of the workspace only, and written by nobody directly", async () => {
    const ids = [items[0]!, items[1]!];
    const sid = await closedSession(ids);
    const app = await apply(f.alice, sid, await reverseMoves(ids));
    const seen = (who: string) => db.asUser(who, async (q) => (await q("select count(*)::int as n from public.alignment_rank_applications where id = $1", [app])).rows[0].n as number);
    expect(await seen(creator)).toBe(1);
    expect(await seen(f.bob)).toBe(0);
    expect(await errorCode(db.asUser(f.alice, (q) => q("update public.alignment_rank_applications set moved = 9 where id = $1", [app])))).toBe("42501");
    expect(await errorCode(db.asUser(f.alice, (q) => q("delete from public.alignment_rank_applications where id = $1", [app])))).toBe("42501");
    expect(await errorCode(db.asUser(f.alice, (q) => q("insert into public.alignment_rank_applications (tenant_id, session_id, scope, moves, moved) values ($1, $2, 'all', '[]', 1)", [f.tenantA, sid])))).toBe("42501");
    await undo(f.alice, app);
  });
});
