import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Phone quick actions (issue #635): item_quick_change changes Health or Initiative Status with a note kept on the audit row, and change_notes reads the notes.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string;
const DENIED = "42501", BAD = "22023", CHECK = "23514";
type Audit = { field: string; old: unknown; new: unknown; actor_id: string | null; via: string; basis: string | null };

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-qc@example.test");
  viewer = await createUser(db, "viewer-qc@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
});
afterAll(async () => {
  await db.close();
});

const item = async (tenant = f.tenantA, project = f.seedA.project) =>
  (await db.admin.query("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, 'Quick change', $2) returning id", [tenant, project])).rows[0].id as string;
const change = (user: string, id: string, field: string, value: string, note: string | null = null) =>
  db.asUser(user, async (q) => (await q("select public.item_quick_change($1, $2, $3, $4) as r", [id, field, value, note])).rows[0].r as { field: string; old: string | null; new: string }, { commit: true, via: "UI" });
const audit = async (id: string, field: string) =>
  (await db.admin.query("select field, old, new, actor_id, via, basis from public.audit_log where entity = 'items' and entity_id = $1 and field = $2 order by id", [id, field])).rows as Audit[];

describe("item_quick_change", () => {
  it("changes Health and records the note, the actor and the source on the audit row", async () => {
    const id = await item();
    const r = await change(creator, id, "health", "At Risk", "  Vendor slipped the API by two weeks  ");
    expect(r).toMatchObject({ field: "health", old: null, new: "At Risk" });
    expect((await db.admin.query("select health from public.items where id = $1", [id])).rows[0].health).toBe("At Risk");
    const rows = await audit(id, "health");
    expect(rows[rows.length - 1]).toMatchObject({ new: "At Risk", actor_id: creator, via: "UI", basis: "Vendor slipped the API by two weeks" });
  });

  it("changes Initiative Status with a note, and a later normal edit carries no note", async () => {
    const id = await item();
    await change(creator, id, "initiative_status", "On hold", "Waiting for the legal review");
    await db.asUser(creator, (q) => q("update public.items set initiative_status = 'Active' where id = $1", [id]), { commit: true, via: "UI" });
    const rows = await audit(id, "initiative_status");
    expect(rows.map((r) => r.basis)).toEqual(["Waiting for the legal review", null]);
  });

  it("asks for a note when the value is a concern, and not otherwise", async () => {
    const id = await item();
    for (const [field, value] of [["health", "At Risk"], ["health", "Delayed"], ["health", "Blocked"], ["initiative_status", "On hold"], ["initiative_status", "Cancelled"]] as const) {
      expect(await errorCode(change(creator, id, field, value))).toBe(BAD);
      expect(await errorCode(change(creator, id, field, value, "abc"))).toBe(BAD);
    }
    expect((await change(creator, id, "health", "On Track")).new).toBe("On Track");
    expect((await change(creator, id, "initiative_status", "Active", "Back on")).new).toBe("Active");
    const rows = await audit(id, "health");
    expect(rows[rows.length - 1]!.basis).toBeNull(); // no note given, none recorded
  });

  it("refuses other fields, an empty value, a value the column does not allow and a note that is too long", async () => {
    const id = await item();
    expect(await errorCode(change(creator, id, "initiative_phase", "Build", "moving it"))).toBe(BAD);
    expect(await errorCode(change(creator, id, "value_12m", "1000", "no"))).toBe(BAD);
    expect(await errorCode(change(creator, id, "health", "  "))).toBe(BAD);
    expect(await errorCode(change(creator, id, "health", "Great", "fine"))).toBe(CHECK);
    expect(await errorCode(change(creator, id, "health", "On Track", "x".repeat(301)))).toBe(BAD);
  });

  it("is refused for a viewer, for another workspace's member and for a deleted initiative", async () => {
    const id = await item();
    expect(await errorCode(change(viewer, id, "health", "On Track"))).toBe(DENIED);
    expect(await errorCode(change(f.bob, id, "health", "On Track"))).toBe(DENIED);
    await db.admin.query("update public.items set deleted_at = now() where id = $1", [id]);
    expect(await errorCode(change(creator, id, "health", "On Track"))).toBe(DENIED);
    expect(await errorCode(db.asAnon((q) => q("select public.item_quick_change($1, 'health', 'On Track', null)", [id])))).toBe(DENIED);
  });

  it("does not let a note leak onto a later change in the same session", async () => {
    const id = await item();
    await db.asUser(creator, async (q) => {
      await q("select public.item_quick_change($1, 'health', 'Delayed', 'Late supplier')", [id]);
      await q("update public.items set initiative_status = 'Active' where id = $1", [id]);
    }, { commit: true, via: "UI" });
    expect((await audit(id, "health")).pop()!.basis).toBe("Late supplier");
    expect((await audit(id, "initiative_status")).pop()!.basis).toBeNull();
  });
});

describe("change_notes", () => {
  it("returns the notes of Health and Status changes to every member, and nothing else", async () => {
    const id = await item();
    await change(creator, id, "health", "Blocked", "Waiting on the data team");
    await db.asUser(creator, (q) => q("update public.items set effort = 'M' where id = $1", [id]), { commit: true, via: "UI" });
    const ids = (await db.admin.query("select id from public.audit_log where entity = 'items' and entity_id = $1", [id])).rows.map((r) => Number(r.id));
    const notes = (user: string) => db.asUser(user, async (q) => (await q("select * from public.change_notes($1, $2)", [f.tenantA, ids])).rows as { id: string; note: string }[]);
    for (const user of [viewer, creator]) {
      const rows = await notes(user);
      expect(rows.map((r) => r.note)).toEqual(["Waiting on the data team"]);
    }
  });

  it("never returns another basis, such as the words behind a Business Value Type", async () => {
    const id = await item();
    // the way Claude's write path records the words behind a Business Value Type (migration 0056): a transaction-local setting and the audit trigger
    await db.admin.query("begin");
    await db.admin.query("select set_config('pv.value_type_basis', 'The product owner said it is about defending revenue', true)");
    await db.admin.query("update public.items set value_type = 'Defend revenue' where id = $1", [id]);
    await db.admin.query("commit");
    const vt = (await db.admin.query("select id, basis from public.audit_log where entity = 'items' and entity_id = $1 and field = 'value_type'", [id])).rows;
    expect(vt).toHaveLength(1);
    expect(vt[0].basis).toBe("The product owner said it is about defending revenue"); // the basis really is there ...
    const rows = await db.asUser(creator, async (q) => (await q("select * from public.change_notes($1, $2)", [f.tenantA, vt.map((r) => Number(r.id))])).rows);
    expect(rows).toEqual([]); // ... and change_notes does not return it
  });

  it("refuses another workspace, anonymous callers and a very long list", async () => {
    const call = (user: string, tenant: string, ids: number[]) => db.asUser(user, (q) => q("select * from public.change_notes($1, $2)", [tenant, ids]));
    expect(await errorCode(call(f.bob, f.tenantA, [1]))).toBe(DENIED);
    expect(await errorCode(db.asAnon((q) => q("select * from public.change_notes($1, $2)", [f.tenantA, [1]])))).toBe(DENIED);
    expect(await errorCode(call(creator, f.tenantA, Array.from({ length: 501 }, (_, i) => i)))).toBe(BAD);
  });

  it("shows nothing of another workspace's changes", async () => {
    const idB = await item(f.tenantB, f.seedB.project);
    await db.asUser(f.bob, (q) => q("select public.item_quick_change($1, 'health', 'Delayed', 'Bob note')", [idB]), { commit: true, via: "UI" });
    const ids = (await db.admin.query("select id from public.audit_log where entity = 'items' and entity_id = $1", [idB])).rows.map((r) => Number(r.id));
    const rows = await db.asUser(creator, async (q) => (await q("select * from public.change_notes($1, $2)", [f.tenantA, ids])).rows);
    expect(rows).toEqual([]);
  });
});
