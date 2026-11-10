import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Issue #394: apply the vote of a closed session to the Stack Rank, once, audited, undoable, by a person only.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, bot: string, items: string[];

type Move = { item: string; from: number; to: number };
const ranks = async (ids = items) => Object.fromEntries((await db.admin.query("select id, stack_rank, previous_rank from public.items where id = any($1::uuid[])", [ids])).rows.map((r) => [r.id, { rank: r.stack_rank as number, prev: r.previous_rank as number | null }]));
const allRanks = async () => (await db.admin.query("select id, stack_rank from public.items where tenant_id = $1 and deleted_at is null and cycle_id is null order by stack_rank", [f.tenantA])).rows.map((r) => `${r.id}:${r.stack_rank}`);

/**
 * A closed session over the given items with a stored snapshot. The vote prefers the initiative the team ranks last, then the one before it, and so on
 * (so `reverseMoves` is exactly the vote's suggestion), unless `places` gives the place of each item.
 */
async function closedSession(ids = items.slice(0, 4), places?: Record<string, number>, joint = true) {
  const sid = await db.asUser(f.alice, async (q) => (await q("select public.alignment_session_create('Rank apply', 'coins', $1::uuid[]) as id", [ids])).rows[0].id as string, { commit: true, via: "UI" });
  await db.asUser(f.alice, (q) => q("select public.alignment_session_set_state($1, 'open')", [sid]), { commit: true });
  await db.asUser(f.alice, (q) => q("select public.alignment_session_set_state($1, 'closed')", [sid]), { commit: true });
  const ai = (await db.admin.query("select id, item_id from public.alignment_items where session_id = $1", [sid])).rows as { id: string; item_id: string }[];
  const now = await ranks(ids);
  const worstFirst = [...ids].sort((a, b) => now[b]!.rank - now[a]!.rank);
  const placeOf = (item: string) => places?.[item] ?? worstFirst.indexOf(item) + 1;
  const snapshot = { version: 1, voters: 5, invited: 5, results: { voters: 5, joint: joint ? ai.map((a) => ({ itemId: a.id, score: 100 - 10 * placeOf(a.item_id), place: placeOf(a.item_id), tied: false })) : [], groups: null, groupsNote: null, contested: [] } };
  await db.asService(async (q) => { await q("select public.alignment_results_store($1, $2::jsonb)", [sid, JSON.stringify(snapshot)]); }, { commit: true });
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
    const keep = [{ ...a, to: a!.from }, { ...b, to: b!.from }]; // keeps today's order against a vote that swaps them
    expect(await errorCode(apply(f.alice, sid, keep))).toBe("PV026"); // that is a difference from the vote: it needs reasons first
    expect(await errorCode(apply(f.alice, sid, keep.map((m) => ({ ...m, reason: "keep" }))))).toBe("22023"); // with reasons nothing would change, so nothing is applied
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

  it("the table can be read by admins of the workspace only (issue #392), and written by nobody directly", async () => {
    const ids = [items[0]!, items[1]!];
    const sid = await closedSession(ids);
    const app = await apply(f.alice, sid, await reverseMoves(ids));
    const seen = (who: string) => db.asUser(who, async (q) => (await q("select count(*)::int as n from public.alignment_rank_applications where id = $1", [app])).rows[0].n as number);
    expect(await seen(f.alice)).toBe(1);
    expect(await seen(creator)).toBe(0);
    expect(await seen(f.bob)).toBe(0);
    expect(await errorCode(db.asUser(f.alice, (q) => q("update public.alignment_rank_applications set moved = 9 where id = $1", [app])))).toBe("42501");
    expect(await errorCode(db.asUser(f.alice, (q) => q("delete from public.alignment_rank_applications where id = $1", [app])))).toBe("42501");
    expect(await errorCode(db.asUser(f.alice, (q) => q("insert into public.alignment_rank_applications (tenant_id, session_id, scope, moves, moved) values ($1, $2, 'all', '[]', 1)", [f.tenantA, sid])))).toBe("42501");
    await undo(f.alice, app);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Issue #397: the admin decides the final order; the vote is the starting point; every difference from it needs a reason (admins only).
describe("deciding the final order, with reasons (issue #397)", () => {
  /** Moves for the given final order of the items, onto the positions they hold now. */
  async function movesFor(order: string[], reasons: Record<string, string> = {}): Promise<(Move & { reason?: string })[]> {
    const r = await ranks(order);
    const slots = order.map((id) => r[id]!.rank).sort((a, b) => a - b);
    return order.map((id, i) => ({ item: id, from: r[id]!.rank, to: slots[i]!, ...(reasons[id] ? { reason: reasons[id] } : {}) }));
  }
  const reasonRows = async (app: string) => (await db.admin.query("select * from public.alignment_rank_reasons where application_id = $1 order by to_rank", [app])).rows;
  const sorted = async (ids: string[]) => { const r = await ranks(ids); return [...ids].sort((a, b) => r[a]!.rank - r[b]!.rank); };
  const decisions = (user: string, item: string, tenant = f.tenantA) => db.asUser(user, async (q) => (await q("select * from public.item_alignment_decisions($1, $2)", [tenant, item])).rows);

  it("applying the vote's own order needs no reason and stores none", async () => {
    const ids = [items[0]!, items[1]!, items[2]!];
    const sid = await closedSession(ids);
    const app = await apply(f.alice, sid, await reverseMoves(ids));
    expect(await reasonRows(app)).toEqual([]);
    await undo(f.alice, app);
  });

  it("an order that differs from the vote is refused without a reason for each difference, and nothing changes", async () => {
    const ids = [items[0]!, items[1]!, items[2]!];
    const sid = await closedSession(ids);
    const [x, y, z] = await sorted(ids); // the vote prefers z, then y, then x
    const before = await allRanks();
    // the person puts y first: y and z differ from the vote, x matches it
    expect(await errorCode(apply(f.alice, sid, await movesFor([y!, z!, x!])))).toBe("PV026");
    expect(await errorCode(apply(f.alice, sid, await movesFor([y!, z!, x!], { [y!]: "Customer deadline" })))).toBe("PV026"); // z still has none
    expect(await allRanks()).toEqual(before);
    expect((await db.admin.query("select count(*)::int as n from public.alignment_rank_applications where session_id = $1", [sid])).rows[0].n).toBe(0);
  });

  it("with reasons it applies, stores a reason only where the final rank differs from the vote, and an admin reads them", async () => {
    const ids = [items[0]!, items[1]!, items[2]!];
    const sid = await closedSession(ids);
    const [x, y, z] = await sorted(ids);
    const r0 = await ranks(ids);
    const app = await apply(f.alice, sid, await movesFor([y!, z!, x!], { [y!]: "  Customer   deadline  ", [z!]: "Depends on y", [x!]: "not needed: it matches the vote" }));
    const rows = await reasonRows(app);
    expect(rows.map((r) => r.item_id).sort()).toEqual([y, z].sort()); // x matches the vote: no row, its reason is ignored
    expect(rows.find((r) => r.item_id === y)).toMatchObject({ from_rank: r0[y!]!.rank, to_rank: r0[x!]!.rank, reason: "Customer deadline", created_by: f.alice, created_via: "UI" });
    // the vote (z, y, x) onto the held positions gives z the first, y the second; the person gave y the first and z the second
    expect(rows.find((r) => r.item_id === y)!.crowd_rank).toBe(r0[y!]!.rank);
    expect(rows.find((r) => r.item_id === z)!.crowd_rank).toBe(r0[x!]!.rank);
    const after = await ranks(ids);
    expect(after[y!]!.rank).toBe(r0[x!]!.rank);
    expect(after[z!]!.rank).toBe(r0[y!]!.rank);
    expect(after[x!]!.rank).toBe(r0[z!]!.rank);
    expect((await db.admin.query("select moved from public.alignment_rank_applications where id = $1", [app])).rows[0].moved).toBe(3);
    await undo(f.alice, app);
  });

  it("an initiative that stays where it is, against a vote that moves it, still needs and keeps a reason", async () => {
    const ids = [items[0]!, items[1]!, items[2]!];
    const sid = await closedSession(ids);
    const [x, y, z] = await sorted(ids); // the vote moves x last; the person keeps x first and swaps the other two
    expect(await errorCode(apply(f.alice, sid, await movesFor([x!, z!, y!], { [z!]: "a", [y!]: "b" })))).toBe("PV026"); // x differs from the vote
    const app = await apply(f.alice, sid, await movesFor([x!, z!, y!], { [x!]: "Keep: contract date", [z!]: "a", [y!]: "b" }));
    const rows = await reasonRows(app);
    expect(rows.find((r) => r.item_id === x)).toMatchObject({ reason: "Keep: contract date" });
    expect(rows.find((r) => r.item_id === x)!.from_rank).toBe(rows.find((r) => r.item_id === x)!.to_rank); // it did not move
    await undo(f.alice, app);
  });

  it("a reason must be 1 to 300 characters: empty, blank and too long are refused, 300 is fine", async () => {
    const ids = [items[0]!, items[1]!, items[2]!];
    const sid = await closedSession(ids);
    const [x, y, z] = await sorted(ids);
    const order = [y!, z!, x!];
    for (const bad of ["", "   ", "x".repeat(301)]) expect(await errorCode(apply(f.alice, sid, await movesFor(order, { [y!]: bad, [z!]: "ok" })))).toBe("PV026");
    const app = await apply(f.alice, sid, await movesFor(order, { [y!]: "x".repeat(300), [z!]: "ok" }));
    expect((await reasonRows(app)).find((r) => r.item_id === y)!.reason).toHaveLength(300);
    await undo(f.alice, app);
  });

  it("the database works out what the vote suggests itself, so a claimed match cannot skip a reason", async () => {
    const ids = [items[0]!, items[1]!, items[2]!];
    const sid = await closedSession(ids);
    const [x, y, z] = await sorted(ids);
    const lying = (await movesFor([y!, z!, x!])).map((m) => ({ ...m, crowd_to: m.to, matches_vote: true }));
    expect(await errorCode(apply(f.alice, sid, lying))).toBe("PV026");
  });

  it("a session whose stored vote has no place for an initiative cannot be applied", async () => {
    const ids = [items[0]!, items[1]!];
    const sid = await closedSession(ids, undefined, false);
    expect(await errorCode(apply(f.alice, sid, await reverseMoves(ids)))).toBe("22023");
  });

  it("reasons are for admins only: members read none through the table or the function; another workspace reads none", async () => {
    const ids = [items[0]!, items[1]!, items[2]!];
    const sid = await closedSession(ids);
    const [x, y, z] = await sorted(ids);
    const app = await apply(f.alice, sid, await movesFor([y!, z!, x!], { [y!]: "Secret: a customer may leave", [z!]: "second" }));
    const seen = (who: string) => db.asUser(who, async (q) => (await q("select count(*)::int as n from public.alignment_rank_reasons where application_id = $1", [app])).rows[0].n as number);
    expect(await seen(f.alice)).toBe(2);
    expect(await seen(creator)).toBe(0);
    expect(await seen(f.bob)).toBe(0);
    expect((await decisions(f.alice, y!)).map((r) => r.reason)).toEqual(["Secret: a customer may leave"]);
    expect(await decisions(creator, y!)).toEqual([]);
    expect(await decisions(f.bob, y!)).toEqual([]);
    expect(await decisions(f.bob, y!, f.tenantB)).toEqual([]);
    // a member cannot read the application at all, and the application row itself carries no reason text
    expect(await db.asUser(creator, async (q) => (await q("select moves from public.alignment_rank_applications where id = $1", [app])).rows)).toEqual([]);
    const row = (await db.asUser(f.alice, async (q) => (await q("select moves from public.alignment_rank_applications where id = $1", [app])).rows[0])) as { moves: unknown };
    expect(JSON.stringify(row.moves)).not.toMatch(/Secret|reason|customer/);
    // nobody writes the table directly
    expect(await errorCode(db.asUser(f.alice, (q) => q("update public.alignment_rank_reasons set reason = 'x' where application_id = $1", [app])))).toBe("42501");
    await undo(f.alice, app);
  });

  it("undo keeps the reasons with the undone application, and the panel function stops showing them", async () => {
    const ids = [items[0]!, items[1]!, items[2]!];
    const sid = await closedSession(ids);
    const [x, y, z] = await sorted(ids);
    const app = await apply(f.alice, sid, await movesFor([y!, z!, x!], { [y!]: "because", [z!]: "so" }));
    expect((await decisions(f.alice, y!)).length).toBe(1);
    await undo(f.alice, app);
    expect((await reasonRows(app)).length).toBe(2);
    expect(await decisions(f.alice, y!)).toEqual([]);
  });

  it("the audit log records the person, and the reasons never appear in the item's own audit entries", async () => {
    const ids = [items[0]!, items[1]!, items[2]!];
    const sid = await closedSession(ids);
    const [x, y, z] = await sorted(ids);
    const t0 = (await db.admin.query("select coalesce(max(id), 0) as m from public.audit_log")).rows[0].m;
    const app = await apply(f.alice, sid, await movesFor([y!, z!, x!], { [y!]: "Reason text one", [z!]: "Reason text two" }));
    const rows = (await db.admin.query("select entity, field, new, actor_id, via from public.audit_log where id > $1 order by id", [t0])).rows;
    const itemsAudit = rows.filter((r) => r.entity === "items");
    expect(JSON.stringify(itemsAudit)).not.toMatch(/Reason text/);
    expect(rows.filter((r) => r.entity === "alignment_rank_reasons" && r.field === "reason").length).toBe(2);
    expect(rows.filter((r) => r.entity === "alignment_rank_reasons").every((r) => r.actor_id === f.alice && r.via === "UI")).toBe(true);
    expect(rows.find((r) => r.field === "rank_applied")!.new).toMatchObject({ differs_from_vote: 2, moved: 3 });
    await undo(f.alice, app);
  });

  it("Claude, a service account, a creator and another workspace still cannot apply an order with reasons", async () => {
    const ids = [items[0]!, items[1]!, items[2]!];
    const sid = await closedSession(ids);
    const [x, y, z] = await sorted(ids);
    const moves = await movesFor([y!, z!, x!], { [y!]: "a", [z!]: "b" });
    expect(await errorCode(apply(f.alice, sid, moves, "all", { via: "MCP" }))).toBe("PV004");
    expect(await errorCode(apply(bot, sid, moves))).toBe("PV004");
    expect(await errorCode(apply(creator, sid, moves))).toBe("42501");
    expect(await errorCode(apply(f.bob, sid, moves))).toBe("42501");
  });
});
