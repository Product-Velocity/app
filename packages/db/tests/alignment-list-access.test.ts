import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, twoTenantFixture, type TestDb } from "./helpers";

// Issue #392: the Alignment tab. Admins read every session; everyone else reads only closed or archived sessions that allow results.
// Decided in the database (Ashu, 2026-11-10), so the API cannot list what the page hides. This also closes #400.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, commenter: string, viewer: string, items: string[];

/** A session over the first three items in the given state and with show_results as given. Closed ones get a stored snapshot. */
async function session(state: "draft" | "open" | "closed" | "archived", showResults: boolean, name = `S ${state}`) {
  const sid = await db.asUser(f.alice, async (q) => (await q("select public.alignment_session_create($1, 'coins', $2::uuid[]) as id", [name, items.slice(0, 3)])).rows[0].id as string, { commit: true, via: "UI" });
  await db.asUser(f.alice, (q) => q("select public.alignment_session_configure($1, $2, 'coins', '[{\"id\":\"all\",\"name\":\"All\"}]'::jsonb, 'equal', '{}', 100, 30, $3, 12, null)", [sid, name, showResults]), { commit: true });
  const step = (to: string) => db.asUser(f.alice, (q) => q("select public.alignment_session_set_state($1, $2)", [sid, to]), { commit: true });
  if (state !== "draft") await step("open");
  if (state === "closed" || state === "archived") {
    await step("closed");
    await db.asService(async (q) => { await q("select public.alignment_results_store($1, $2::jsonb)", [sid, JSON.stringify({ version: 1, voters: 7, results: { voters: 7, joint: [], groups: null, groupsNote: null, contested: [] } })]); }, { commit: true });
  }
  if (state === "archived") await step("archived");
  return sid;
}
const sessionsSeenBy = (user: string, ids: string[]) => db.asUser(user, async (q) => (await q("select id from public.alignment_sessions where id = any($1::uuid[])", [ids])).rows.map((r) => r.id as string));
const itemsSeenBy = (user: string, sid: string) => db.asUser(user, async (q) => (await q("select count(*)::int as n from public.alignment_items where session_id = $1", [sid])).rows[0].n as number);
const stats = (user: string, tenant = f.tenantA) => db.asUser(user, async (q) => (await q("select * from public.alignment_session_stats($1)", [tenant])).rows);

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "list-creator@example.test");
  commenter = await createUser(db, "list-commenter@example.test");
  viewer = await createUser(db, "list-viewer@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, commenter, "commenter");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  const project = (await db.admin.query("select id from public.projects where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id;
  for (let n = 0; n < 4; n++) await db.admin.query("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, $2, $3)", [f.tenantA, `List item ${n}`, project]);
  items = (await db.admin.query("select id from public.items where tenant_id = $1 and initiative_name like 'List item %' order by initiative_name", [f.tenantA])).rows.map((r) => r.id);
});
afterAll(async () => { await db.close(); });

describe("who reads which session", () => {
  it("an admin reads every session; a creator, a commenter and a viewer read only closed or archived sessions that allow results", async () => {
    const draft = await session("draft", true), open = await session("open", true);
    const closedOff = await session("closed", false), closedOn = await session("closed", true), archivedOn = await session("archived", true), archivedOff = await session("archived", false);
    const all = [draft, open, closedOff, closedOn, archivedOn, archivedOff];
    expect((await sessionsSeenBy(f.alice, all)).sort()).toEqual([...all].sort());
    for (const who of [creator, commenter, viewer]) expect((await sessionsSeenBy(who, all)).sort(), who).toEqual([closedOn, archivedOn].sort());
  });

  it("another workspace reads none of them, admin or not", async () => {
    const sid = await session("closed", true);
    expect(await sessionsSeenBy(f.bob, [sid])).toEqual([]);
  });

  it("the initiatives of a session follow the session: a member cannot list those of a draft, an open session or one without results", async () => {
    const draft = await session("draft", true), open = await session("open", true), off = await session("closed", false), on = await session("closed", true);
    for (const who of [creator, commenter, viewer]) {
      expect(await itemsSeenBy(who, draft)).toBe(0);
      expect(await itemsSeenBy(who, open)).toBe(0);
      expect(await itemsSeenBy(who, off)).toBe(0);
      expect(await itemsSeenBy(who, on)).toBe(3);
    }
    expect(await itemsSeenBy(f.alice, draft)).toBe(3);
    expect(await itemsSeenBy(f.bob, on)).toBe(0);
  });

  it("the stored results are readable only where results are allowed (#400): a viewer gets nothing for a closed session with results off", async () => {
    const off = await session("closed", false), on = await session("closed", true);
    const snap = (who: string, sid: string) => db.asUser(who, async (q) => (await q("select results_snapshot from public.alignment_sessions where id = $1", [sid])).rows);
    expect(await snap(viewer, off)).toEqual([]);
    expect((await snap(viewer, on)).length).toBe(1); // allowed: the anonymous results
    expect((await snap(f.alice, off)).length).toBe(1);
  });

  it("mailings and the applications of a vote are for admins only", async () => {
    const sid = await session("closed", true);
    await db.admin.query("insert into public.alignment_mailings (tenant_id, session_id, kind, subject, body) values ($1, $2, 'invitation', 'S', 'B')", [f.tenantA, sid]);
    await db.admin.query("insert into public.alignment_rank_applications (tenant_id, session_id, scope, moves, moved) values ($1, $2, 'all', '[]', 1)", [f.tenantA, sid]);
    for (const table of ["alignment_mailings", "alignment_rank_applications"]) {
      const n = (who: string) => db.asUser(who, async (q) => (await q(`select count(*)::int as n from public.${table} where session_id = $1`, [sid])).rows[0].n as number);
      expect(await n(f.alice), table).toBe(1);
      for (const who of [creator, commenter, viewer, f.bob]) expect(await n(who), `${table} ${who}`).toBe(0);
    }
  });
});

describe("alignment_session_stats", () => {
  it("gives an admin the totals per session and nobody else any row", async () => {
    const sid = await session("open", false, "Stats session");
    await db.asUser(f.alice, (q) => q("select public.alignment_participants_add($1, $2::jsonb)", [sid, JSON.stringify([{ email: "a@example.test", group: "all" }, { email: "b@example.test", group: "all" }, { email: "c@example.test", group: "all" }])]), { commit: true });
    await db.admin.query("update public.alignment_participants set invited_at = now() where session_id = $1 and email in ('a@example.test', 'b@example.test')", [sid]); // two were invited
    const pid = (await db.admin.query("select id from public.alignment_participants where session_id = $1 and email = 'a@example.test'", [sid])).rows[0].id;
    await db.admin.query("insert into public.alignment_ballots (tenant_id, session_id, participant_id, group_id, state) values ($1, $2, $3, 'all', 'submitted')", [f.tenantA, sid, pid]);
    await db.admin.query("insert into public.alignment_mailings (tenant_id, session_id, kind, subject, body) values ($1, $2, 'reminder', 'S', 'B')", [f.tenantA, sid]); // a draft
    const row = (await stats(f.alice)).find((r) => r.session_id === sid);
    expect(row).toMatchObject({ invited: 2, voted: 1, mailing_draft: true, applied_at: null, applied_moved: null, undone: false });
    for (const who of [creator, commenter, viewer, f.bob]) expect(await stats(who), who).toEqual([]);
    expect((await stats(f.bob, f.tenantB)).some((r) => r.session_id === sid)).toBe(false); // bob is an admin of the other workspace: he sees its sessions, not this one
    expect(await stats(f.bob, f.tenantA)).toEqual([]); // and nothing of this workspace even when he asks for it
  });

  it("reports the latest application that was not undone, and an application that was only undone", async () => {
    const applied = await session("closed", true, "Applied"), undone = await session("closed", true, "Undone"), none = await session("closed", true, "None");
    await db.admin.query("insert into public.alignment_rank_applications (tenant_id, session_id, scope, moves, moved) values ($1, $2, 'all', '[]', 3), ($1, $2, 'all', '[]', 5)", [f.tenantA, applied]);
    // the write trigger stamps created_at on insert, so the times are set afterwards
    await db.admin.query("update public.alignment_rank_applications set created_at = '2027-02-01T10:00:00Z' where session_id = $1 and moved = 3", [applied]);
    await db.admin.query("update public.alignment_rank_applications set created_at = '2027-02-02T10:00:00Z' where session_id = $1 and moved = 5", [applied]);
    await db.admin.query("insert into public.alignment_rank_applications (tenant_id, session_id, scope, moves, moved, undone_at) values ($1, $2, 'all', '[]', 4, now())", [f.tenantA, undone]);
    const rows = await stats(f.alice);
    const by = (id: string) => rows.find((r) => r.session_id === id)!;
    expect(by(applied)).toMatchObject({ applied_moved: 5, undone: false });
    expect(new Date(by(applied).applied_at).toISOString()).toBe("2027-02-02T10:00:00.000Z"); // the latest
    expect(by(undone)).toMatchObject({ applied_at: null, applied_moved: null, undone: true });
    expect(by(none)).toMatchObject({ applied_at: null, undone: false, mailing_draft: false });
  });

  it("returns totals only: no name, email, ballot or group column", async () => {
    const cols = (await db.asUser(f.alice, async (q) => (await q("select * from public.alignment_session_stats($1) limit 1", [f.tenantA])).fields.map((x) => x.name))) as string[];
    expect(cols.sort()).toEqual(["applied_at", "applied_moved", "invited", "mailing_draft", "session_id", "undone", "voted"]);
  });
});
