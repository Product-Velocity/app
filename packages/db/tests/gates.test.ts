import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Decision gates A, B and C (issue #323, docs/28-DECISION-GATES.md): request, decide, complete, fast lane, rights, immutability.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string, approver: string, listed: string, bot: string;
const PV004 = "PV004", PV005 = "PV005", PV006 = "PV006", DENIED = "42501";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "gate-creator@example.test");
  viewer = await createUser(db, "gate-viewer@example.test");
  approver = await createUser(db, "gate-approver@example.test");
  listed = await createUser(db, "gate-listed@example.test");
  bot = await createUser(db, "gate-bot@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  await addMember(db, f.alice, f.tenantA, approver, "creator");
  await addMember(db, f.alice, f.tenantA, listed, "creator");
  await addMember(db, f.alice, f.tenantA, bot, "creator", { serviceAccount: true });
  await db.admin.query("update public.tenant_members set is_approver = true where tenant_id = $1 and user_id = $2", [f.tenantA, approver]);
});
afterAll(async () => { await db.close(); });

const commit = { commit: true, via: "UI" } as const;
const newItem = (phase: string | null = "Discover", name = "Gate item") =>
  db.admin.query("insert into public.items (tenant_id, initiative_name, home_project_id, initiative_phase) values ($1, $2, $3, $4) returning id", [f.tenantA, name, f.seedA.project, phase]).then((r) => r.rows[0].id as string);
const item = async (id: string) => (await db.admin.query("select * from public.items where id = $1", [id])).rows[0];
const computed = async (id: string) => (await db.admin.query("select * from public.items_computed where id = $1", [id])).rows[0];
const request = (user: string, id: string, gate: string, opts: { via?: string } = {}) =>
  db.asUser(user, async (q) => (await q("select public.request_gate($1, $2, true, '[{\"label\":\"PRD written\",\"ok\":true}]'::jsonb) as id", [id, gate])).rows[0].id as string, { commit: true, via: opts.via ?? "UI" });
const decide = (user: string, review: string, outcome: string, rationale = "Looks right to me", extra: unknown[] = [], via = "UI") =>
  db.asUser(user, async (q) => (await q("select public.decide_gate($1, $2, $3, $4, $5, $6, $7) as r", [review, outcome, rationale, extra[0] ?? false, extra[1] ?? null, extra[2] ?? [], extra[3] ?? null])).rows[0].r as Record<string, unknown>, { commit: true, via });
const doc = (id: string, kind: string, status = "in_review") =>
  db.admin.query("insert into public.item_documents (tenant_id, item_id, kind, title, status) values ($1, $2, $3, 'Doc', $4) returning id", [f.tenantA, id, kind, status]).then((r) => r.rows[0].id as string);
const docRow = async (id: string) => (await db.admin.query("select * from public.item_documents where id = $1", [id])).rows[0];

describe("gate A: Discover to Define", () => {
  it("a Creator requests, an Admin decides: the phase moves, the discovery is approved, everything is audited", async () => {
    const id = await newItem("Discover");
    const d = await doc(id, "discovery");
    expect(await item(id)).toMatchObject({ current_gate: "A", gate_status: "Not started" });
    const review = await request(creator, id, "A");
    expect(await item(id)).toMatchObject({ current_gate: "A", gate_status: "Waiting for Approver", initiative_phase: "Discover" });
    const r = await decide(f.alice, review, "go", "Discovery is solid");
    expect(r).toMatchObject({ outcome: "go", phase: "Define", fast_lane: false });
    expect(await item(id)).toMatchObject({ initiative_phase: "Define", current_gate: "B", gate_status: "Not started" });
    expect(await docRow(d)).toMatchObject({ status: "approved", approved_by: f.alice });
    const rev = (await db.admin.query("select * from public.gate_reviews where id = $1", [review])).rows[0];
    expect(rev).toMatchObject({ outcome: "go", rationale: "Discovery is solid", decided_by: f.alice, requested_by: creator, fast_lane: false });
    const audit = (await db.admin.query("select field, via from public.audit_log where entity = 'items' and entity_id = $1 and field = 'initiative_phase' order by id desc limit 1", [id])).rows[0];
    expect(audit).toMatchObject({ field: "initiative_phase", via: "UI" });
    expect((await db.admin.query("select count(*)::int as n from public.audit_log where entity = 'gate_reviews' and entity_id = $1", [review])).rows[0].n).toBeGreaterThan(0);
  });

  it("a request is closed to a second request, and the first decision wins", async () => {
    const id = await newItem("Discover");
    const review = await request(creator, id, "A");
    expect(await errorCode(request(creator, id, "A"))).toBe(PV006);
    await decide(f.alice, review, "go");
    expect(await errorCode(decide(approver, review, "stop", "Too late"))).toBe(PV006);
    expect((await item(id)).initiative_phase).toBe("Define");
  });

  it("needs a rationale and a known outcome", async () => {
    const id = await newItem("Discover");
    const review = await request(creator, id, "A");
    expect(await errorCode(decide(f.alice, review, "go", " "))).toBe(PV005);
    expect(await errorCode(decide(f.alice, review, "maybe"))).toBe(PV005);
    expect((await item(id)).initiative_phase).toBe("Discover");
  });
});

describe("gate B: Define to Build (the PRD is approved, ready for build)", () => {
  it("approves the PRD only, moves to Build, shows Ready for build and starts Build time when the tracker starts", async () => {
    const id = await newItem("Define");
    const prd = await doc(id, "prd");
    const discovery = await doc(id, "discovery");
    expect((await computed(id)).ready_for_build).toBe("Not ready");
    const review = await request(creator, id, "B");
    expect((await computed(id)).ready_for_build).toBe("Requested");
    await decide(approver, review, "go", "Approved to build");
    const it1 = await item(id);
    expect(it1).toMatchObject({ initiative_phase: "Build", current_gate: null, ready_for_build_by: approver });
    expect(it1.ready_for_build_at).not.toBeNull();
    expect(it1.start_building).toBeNull(); // Ready for build is waiting, not building
    expect((await computed(id)).ready_for_build).toBe("Ready");
    expect(await docRow(prd)).toMatchObject({ status: "approved" });
    expect(await docRow(discovery)).toMatchObject({ status: "in_review" }); // gate B approves the PRD, nothing else
    await db.admin.query("update public.items set status = 'In progress' where id = $1", [id]); // the tracker says work started
    expect((await item(id)).start_building).not.toBeNull();
    expect((await computed(id)).ready_for_build).toBeNull();
  });

  it("an approver may approve their own request", async () => {
    const id = await newItem("Define");
    const review = await request(approver, id, "B");
    await decide(approver, review, "go", "My own request, my call");
    expect((await item(id)).initiative_phase).toBe("Build");
  });
});

describe("gate C: Experiment to Roll-out", () => {
  it("moves to Roll-out and records the start", async () => {
    const id = await newItem("Experiment");
    const review = await request(creator, id, "C");
    await decide(f.alice, review, "go", "The threshold was met");
    expect(await item(id)).toMatchObject({ initiative_phase: "Roll-out" });
    expect((await item(id)).start_rollout).not.toBeNull();
  });
});

describe("outcomes", () => {
  it("go with conditions keeps the conditions as tasks until they are done", async () => {
    const id = await newItem("Define");
    const review = await request(creator, id, "B");
    await decide(f.alice, review, "go_with_conditions", "Go once legal has looked", [false, null, ["Legal review", "  ", "Privacy note"]]);
    const c = (await db.admin.query("select id, text, done_at from public.gate_conditions where item_id = $1 order by text", [id])).rows;
    expect(c.map((x) => x.text)).toEqual(["Legal review", "Privacy note"]);
    await db.asUser(creator, (q) => q("select public.gate_condition_done($1)", [c[0].id]), commit);
    expect((await db.admin.query("select done_by from public.gate_conditions where id = $1", [c[0].id])).rows[0].done_by).toBe(creator);
    expect(await errorCode(db.admin.query("update public.gate_conditions set text = 'changed' where id = $1", [c[0].id]))).toBe(PV006);
  });

  it("hold keeps the phase and records the review date; stop cancels the initiative", async () => {
    const a = await newItem("Define");
    const ra = await request(creator, a, "B");
    await decide(f.alice, ra, "hold", "Wait for the budget", [false, null, [], "2027-02-01"]);
    expect(await item(a)).toMatchObject({ initiative_phase: "Define", gate_status: "Held" });
    expect((await db.admin.query("select to_char(next_gate_due, 'YYYY-MM-DD') as d from public.items where id = $1", [a])).rows[0].d).toBe("2027-02-01");
    const b = await newItem("Define");
    const rb = await request(creator, b, "B");
    await decide(f.alice, rb, "stop", "Not worth it");
    expect(await item(b)).toMatchObject({ initiative_phase: "Define", gate_status: "Stopped", initiative_status: "Cancelled" });
  });
});

describe("fast lane: a recorded choice, no checks", () => {
  it("the approver picks a later phase; the skipped phases and gates are recorded", async () => {
    const id = await newItem("Define", "Tiny change");
    const review = await request(creator, id, "B"); // no PRD, not even a checklist: nothing blocks
    const r = await decide(f.alice, review, "go", "Tiny, ship it", [true, "Roll-out"]);
    expect(r).toMatchObject({ phase: "Roll-out", fast_lane: true });
    expect(r.skipped_phases).toEqual(["Build", "Test", "Experiment"]);
    expect(await item(id)).toMatchObject({ initiative_phase: "Roll-out" });
    const rows = (await db.admin.query("select gate, kind, fast_lane, decided_by from public.gate_reviews where item_id = $1 order by kind, gate", [id])).rows;
    expect(rows).toEqual([
      { gate: "B", kind: "decision", fast_lane: true, decided_by: f.alice },
      { gate: "C", kind: "skipped", fast_lane: true, decided_by: f.alice },
    ]);
  });

  it("deciding gate B from Discover skips gate A and Define, marked fast lane without the box", async () => {
    const id = await newItem("Discover");
    const review = await request(creator, id, "B");
    const r = await decide(f.alice, review, "go", "We already know this");
    expect(r).toMatchObject({ phase: "Build", fast_lane: true, skipped_phases: ["Define"] });
    expect((await db.admin.query("select gate from public.gate_reviews where item_id = $1 and kind = 'skipped'", [id])).rows).toEqual([{ gate: "A" }]);
  });

  it("refuses a target earlier than the gate opens or beyond Roll-out", async () => {
    const id = await newItem("Define");
    const review = await request(creator, id, "B");
    expect(await errorCode(decide(f.alice, review, "go", "x y z", [true, "Define"]))).toBe(PV005);
    expect(await errorCode(decide(f.alice, review, "go", "x y z", [true, "Completed"]))).toBe(PV005);
  });
});

describe("who can request and who can decide", () => {
  it("viewers cannot request; non-members cannot request or decide", async () => {
    const id = await newItem("Discover");
    expect(await errorCode(request(viewer, id, "A"))).toBe(DENIED);
    expect(await errorCode(request(f.bob, id, "A"))).toBe(DENIED); // an Admin of the other workspace
    const review = await request(creator, id, "A");
    expect(await errorCode(decide(f.bob, review, "go"))).toBe(DENIED);
  });

  it("a Creator without approval rights cannot decide; an Admin can by default; the gate list grants a single gate", async () => {
    const id = await newItem("Discover");
    const review = await request(creator, id, "A");
    expect(await errorCode(decide(creator, review, "go"))).toBe(DENIED);
    expect(await errorCode(decide(listed, review, "go"))).toBe(DENIED);
    await db.asUser(f.alice, (q) => q("select public.set_gate_approvers($1, 'A', array[$2::uuid])", [f.tenantA, listed]), commit);
    expect(await db.asUser(listed, async (q) => (await q("select public.my_decidable_gates($1) as g", [f.tenantA])).rows[0].g, commit)).toEqual(["A"]);
    expect(await errorCode(decide(listed, review, "go"))).toBe(null);
    const other = await newItem("Define");
    const rb = await request(creator, other, "B");
    expect(await errorCode(decide(listed, rb, "go"))).toBe(DENIED); // listed for A only
    expect(await db.asUser(f.alice, async (q) => (await q("select public.my_decidable_gates($1) as g", [f.tenantA])).rows[0].g, commit)).toEqual(["A", "B", "C"]);
  });

  it("only an Admin edits the list", async () => {
    expect(await errorCode(db.asUser(approver, (q) => q("select public.set_gate_approvers($1, 'A', array[$2::uuid])", [f.tenantA, approver]), commit))).toBe(DENIED);
  });

  it("Claude and service accounts can neither request nor decide, not even with approval rights", async () => {
    const id = await newItem("Discover");
    expect(await errorCode(request(creator, id, "A", { via: "MCP" }))).toBe(PV004);
    expect(await errorCode(request(bot, id, "A"))).toBe(PV004);
    const review = await request(creator, id, "A");
    expect(await errorCode(decide(approver, review, "go", "Looks right", [], "MCP"))).toBe(PV004);
    expect(await errorCode(decide(bot, review, "go"))).toBe(PV004);
    await db.admin.query("update public.tenant_members set is_approver = true where tenant_id = $1 and user_id = $2", [f.tenantA, bot]).catch(() => null);
    expect((await item(id)).initiative_phase).toBe("Discover");
  });

  it("the gate and phase cannot be forced from a client", async () => {
    const id = await newItem("Discover");
    for (const sql of ["update public.items set current_gate = 'B' where id = $1", "update public.items set ready_for_build_at = now() where id = $1", "update public.items set gate_status = 'Passed' where id = $1"]) {
      expect(await errorCode(db.asUser(creator, (q) => q(sql, [id]), commit)), sql).toBe(DENIED);
    }
    expect(await errorCode(db.asUser(creator, (q) => q("update public.items set initiative_phase = 'Build' where id = $1", [id]), commit))).toBe(PV006);
    expect(await errorCode(db.asUser(creator, (q) => q("insert into public.gate_reviews (tenant_id, item_id, gate, outcome, decided_at, rationale) values ($1, $2, 'A', 'go', now(), 'sneaky')", [f.tenantA, id]), commit))).toBe(DENIED);
  });
});

describe("a decision is written once", () => {
  it("cannot be edited or deleted, by anyone", async () => {
    const id = await newItem("Discover");
    const review = await request(creator, id, "A");
    await decide(f.alice, review, "go", "Original reason");
    expect(await errorCode(db.admin.query("update public.gate_reviews set rationale = 'rewritten' where id = $1", [review]))).toBe(PV006);
    expect(await errorCode(db.admin.query("update public.gate_reviews set outcome = 'stop' where id = $1", [review]))).toBe(PV006);
    expect(await errorCode(db.admin.query("delete from public.gate_reviews where id = $1", [review]))).toBe(PV006);
    expect((await db.admin.query("select rationale from public.gate_reviews where id = $1", [review])).rows[0].rationale).toBe("Original reason");
  });

  it("goes with the initiative when the initiative is purged", async () => {
    const id = await newItem("Discover");
    await decide(f.alice, await request(creator, id, "A"), "go");
    await db.admin.query("delete from public.items where id = $1", [id]);
    expect((await db.admin.query("select count(*)::int as n from public.gate_reviews where item_id = $1", [id])).rows[0].n).toBe(0);
  });
});

describe("moving without a gate", () => {
  const move = (user: string, id: string, to: string, via = "UI") =>
    db.asUser(user, (q) => q("select public.move_phase($1, $2)", [id, to]), { commit: true, via });

  it("Build to Test to Experiment needs a Creator and no approver", async () => {
    const id = await newItem("Build");
    await move(creator, id, "Test");
    await move(creator, id, "Experiment");
    expect(await item(id)).toMatchObject({ initiative_phase: "Experiment", current_gate: "C", gate_status: "Not started" });
    expect((await item(id)).start_beta).not.toBeNull();
    expect((await item(id)).start_building).not.toBeNull(); // leaving Build closes the start date
  });

  it("refuses a forward move that passes a gate, Claude, viewers and Completed", async () => {
    const id = await newItem("Define");
    expect(await errorCode(move(creator, id, "Build"))).toBe(PV006);
    expect(await errorCode(move(creator, id, "Roll-out"))).toBe(PV006);
    expect(await errorCode(move(creator, id, "Completed"))).toBe(PV005);
    expect(await errorCode(move(viewer, id, "Discover"))).toBe(DENIED);
    expect(await errorCode(move(creator, id, "Test", "MCP"))).toBe(PV004);
  });

  it("moving back is allowed and withdraws an open request", async () => {
    const id = await newItem("Define");
    const review = await request(creator, id, "B");
    await move(creator, id, "Discover");
    expect(await item(id)).toMatchObject({ initiative_phase: "Discover", current_gate: "A", gate_status: "Not started" });
    expect((await db.admin.query("select withdrawn_at from public.gate_reviews where id = $1", [review])).rows[0].withdrawn_at).not.toBeNull();
    expect(await errorCode(decide(f.alice, review, "go"))).toBe(PV006);
  });
});

describe("Completed follows Initiative Status", () => {
  it("Completed puts the phase on Completed; Active gives back the phase it had; Cancelled and On hold leave it", async () => {
    const id = await newItem("Roll-out");
    await db.asUser(creator, (q) => q("update public.items set initiative_status = 'On hold' where id = $1", [id]), commit);
    expect((await item(id)).initiative_phase).toBe("Roll-out");
    await db.asUser(creator, (q) => q("update public.items set initiative_status = 'Completed' where id = $1", [id]), commit);
    expect(await item(id)).toMatchObject({ initiative_phase: "Completed", current_gate: null });
    await db.asUser(creator, (q) => q("update public.items set initiative_status = 'Active' where id = $1", [id]), commit);
    expect((await item(id)).initiative_phase).toBe("Roll-out");
    await db.asUser(creator, (q) => q("update public.items set initiative_status = 'Cancelled' where id = $1", [id]), commit);
    expect((await item(id)).initiative_phase).toBe("Roll-out");
  });

  it("a created item with status Completed starts Completed", async () => {
    const id = (await db.admin.query("insert into public.items (tenant_id, initiative_name, home_project_id, initiative_status) values ($1, 'Done already', $2, 'Completed') returning id", [f.tenantA, f.seedA.project])).rows[0].id as string;
    expect((await item(id)).initiative_phase).toBe("Completed");
  });
});

describe("bulk", () => {
  it("requests and decides many at once; one failing never stops the others", async () => {
    const [a, b, c] = [await newItem("Discover"), await newItem("Discover"), await newItem("Build")];
    const out = await db.asUser(creator, async (q) => (await q("select public.request_gates('A', $1::jsonb) as r", [JSON.stringify([{ item: a, ready: true }, { item: b }, { item: c }])])).rows[0].r as { item: string; ok: boolean; review_id?: string; error?: string }[], commit);
    expect(out.map((x) => x.ok)).toEqual([true, true, false]);
    expect(out[2]!.error).toMatch(/already past gate A/);
    expect((await item(a)).gate_status).toBe("Waiting for Approver");
    expect((await item(b)).gate_status).toBe("In review");
    const reviews = out.filter((x) => x.ok).map((x) => x.review_id!);
    const res = await db.asUser(f.alice, async (q) => (await q("select public.decide_gates($1::uuid[], 'go', 'Batch approved', false, null) as r", [reviews])).rows[0].r as { ok: boolean }[], commit);
    expect(res.map((x) => x.ok)).toEqual([true, true]);
    expect((await item(a)).initiative_phase).toBe("Define");
    expect((await item(b)).initiative_phase).toBe("Define");
  });
});
