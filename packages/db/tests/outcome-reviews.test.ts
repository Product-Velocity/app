import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// The 30, 60 and 90 day outcome reviews and the request for them (Ashu, chat 2026-11-19): who may ask and record, who is told, the due date, isolation.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string, pm: string, bot: string;
const PV004 = "PV004", PV005 = "PV005", PV006 = "PV006", DENIED = "42501";
const ui = { commit: true, via: "UI" } as const;

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "oc-creator@example.test");
  viewer = await createUser(db, "oc-viewer@example.test");
  pm = await createUser(db, "oc-pm@example.test");
  bot = await createUser(db, "oc-bot@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  await addMember(db, f.alice, f.tenantA, pm, "creator");
  await addMember(db, f.alice, f.tenantA, bot, "creator", { serviceAccount: true });
});
afterAll(async () => { await db.close(); });

const newItem = (opts: { rollout?: string | null; manager?: string | null; tenant?: string; project?: string; phase?: string } = {}) =>
  db.admin.query(
    "insert into public.items (tenant_id, initiative_name, home_project_id, initiative_phase, start_rollout, owner_user_id) values ($1, 'Outcome item', $2, $5, $3, $4) returning id",
    [opts.tenant ?? f.tenantA, opts.project ?? f.seedA.project, opts.rollout === undefined ? "2026-10-01" : opts.rollout, opts.manager ?? null, opts.phase ?? "Roll-out"],
  ).then((r) => r.rows[0].id as string);
const ask = (user: string, id: string, days = 30, via = "UI") => db.asUser(user, async (q) => (await q("select public.request_outcome_review($1, $2) as id", [id, days])).rows[0].id as string, { commit: true, via });
const record = (user: string, id: string, days: number, v: unknown, a: unknown, n: unknown) =>
  db.asUser(user, async (q) => (await q("select public.record_outcome_review($1, $2, $3, $4, $5) as id", [id, days, v, a, n])).rows[0].id as string, ui);
const row = async (id: string, days: number) => (await db.admin.query("select * from public.outcome_reviews where item_id = $1 and at_days = $2", [id, days])).rows[0];

describe("request_outcome_review", () => {
  it("a Creator asks: the row has the due date from Start Roll-Out and the Product Manager is told once", async () => {
    const id = await newItem({ manager: pm });
    await ask(creator, id, 30);
    expect(await row(id, 30)).toMatchObject({ requested_by: creator, requested_to: pm, recorded_at: null });
    expect(String((await row(id, 30)).due_on.toISOString?.() ?? (await row(id, 30)).due_on)).toContain("2026-10-31");
    const n = (await db.admin.query("select user_id, kind, payload from public.notifications where item_id = $1 and kind = 'outcome_requested'", [id])).rows;
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ user_id: pm, payload: { at_days: 30 } });
    expect(Object.keys(n[0].payload).sort()).toEqual(["at_days", "item_code", "item_name"]); // nothing commercial in the text
  });

  it("with no Product Manager the person who created the initiative is asked; asking yourself tells nobody", async () => {
    const id = await newItem();
    await db.admin.query("update public.items set created_by = $2 where id = $1", [id, pm]);
    await ask(creator, id, 60);
    expect((await row(id, 60)).requested_to).toBe(pm);
    const self = await newItem({ manager: creator });
    await ask(creator, self, 30);
    expect((await db.admin.query("select count(*)::int as n from public.notifications where item_id = $1", [self])).rows[0].n).toBe(0);
  });

  it("a second request for the same checkpoint is refused; the other checkpoints are open", async () => {
    const id = await newItem();
    await ask(creator, id, 30);
    expect(await errorCode(ask(creator, id, 30))).toBe(PV006);
    await ask(creator, id, 60);
    expect(await errorCode(ask(creator, id, 45))).toBe(PV005);
  });

  it("needs a Start Roll-Out date, and a Creator or Admin (not a viewer, Claude or a service account)", async () => {
    expect(await errorCode(ask(creator, await newItem({ rollout: null, phase: "Build" })))).toBe(PV005);
    const id = await newItem();
    expect(await errorCode(ask(viewer, id))).toBe(DENIED);
    expect(await errorCode(ask(creator, id, 30, "MCP"))).toBe(PV004);
    expect(await errorCode(ask(bot, id))).toBe(PV004);
  });
});

describe("record_outcome_review", () => {
  it("records the value, adoption and note on a requested checkpoint, and again on one nobody asked for", async () => {
    const id = await newItem();
    await ask(creator, id, 30);
    await record(creator, id, 30, 42.5, 18, "  First month  ");
    expect(await row(id, 30)).toMatchObject({ realised_kr_value: "42.5", adoption_pct: "18", notes: "First month", recorded_by: creator });
    expect((await row(id, 30)).recorded_at).not.toBeNull();
    expect((await row(id, 30)).requested_at).not.toBeNull(); // still shows who asked
    await record(creator, id, 90, null, null, "Straight to 90");
    expect(await row(id, 90)).toMatchObject({ requested_at: null, notes: "Straight to 90" });
  });

  it("is checked: something to record, adoption 0 to 100, an editor, never Claude", async () => {
    const id = await newItem();
    expect(await errorCode(record(creator, id, 30, null, null, " "))).toBe(PV005);
    expect(await errorCode(record(creator, id, 30, 1, 101, null))).toBe(PV005);
    expect(await errorCode(record(viewer, id, 30, 1, 1, null))).toBe(DENIED);
    expect(await errorCode(db.asUser(creator, (q) => q("select public.record_outcome_review($1, 30, 1, 1, 'x')", [id]), { commit: true, via: "MCP" }))).toBe(PV004);
  });

  it("every change is audited with who and where from", async () => {
    const id = await newItem();
    const rid = await ask(creator, id, 30);
    await record(creator, id, 30, 7, 7, "x");
    const a = (await db.admin.query("select actor_id, via from public.audit_log where entity = 'outcome_reviews' and entity_id = $1 order by id", [rid])).rows;
    expect(a.length).toBeGreaterThanOrEqual(2);
    expect(a.every((x) => x.via === "UI" && x.actor_id === creator)).toBe(true);
  });
});

describe("isolation between workspaces", () => {
  it("another workspace's member sees no review, cannot ask or record on it, and cannot write the table", async () => {
    const id = await newItem();
    await ask(creator, id, 30);
    const seen = await db.asUser(f.bob, async (q) => (await q("select count(*)::int as n from public.outcome_reviews where item_id = $1", [id])).rows[0].n);
    expect(seen).toBe(0);
    expect(await errorCode(ask(f.bob, id, 60))).toBe(DENIED);
    expect(await errorCode(record(f.bob, id, 30, 1, 1, "x"))).toBe(DENIED);
    expect(await errorCode(db.asUser(creator, (q) => q("update public.outcome_reviews set notes = 'direct' where item_id = $1", [id]), ui))).not.toBeNull();
  });
});
