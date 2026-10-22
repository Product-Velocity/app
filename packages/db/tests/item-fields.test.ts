import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIELDS, FIELD_BY_KEY, columnOnItems, relatedTable } from "../../domain/src/registry";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string;

const DENIED = "42501";
const FK = "23503";
const CHECK = "23514";
const UNIQUE = "23505";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-fields@example.test");
  viewer = await createUser(db, "viewer-fields@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
});
afterAll(async () => {
  await db.close();
});

const columns = async (table: string) =>
  (await db.admin.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1", [table]))
    .rows.map((r) => r.column_name as string);

/** A new item in tenant A for one test, so tests never depend on each other's edits. */
const fresh = async () =>
  (await db.admin.query("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, 'Fields test', $2) returning id", [f.tenantA, f.seedA.project])).rows[0].id as string;

const phase1 = FIELDS.filter((x) => x.phase === 1);

describe("the schema holds every phase-1 field of the dictionary", () => {
  it("has a column on items for every phase-1 field stored there", async () => {
    const have = new Set(await columns("items"));
    const missing = phase1.map(columnOnItems).filter((c): c is string => c !== null && !have.has(c));
    expect(missing).toEqual([]);
  });

  it("has a related table for every phase-1 multi-value field", async () => {
    for (const x of phase1) {
      const t = relatedTable(x);
      if (t) expect((await columns(t)).length, `${x.key} -> ${t}`).toBeGreaterThan(0);
    }
  });

  it("has no leftover column under an old name", async () => {
    const have = new Set(await columns("items"));
    for (const old of ["key", "title", "value", "size", "owner_user_id", "end_date", "delivery_progress", "target_segments"]) {
      expect(have.has(old), old).toBe(false);
    }
  });

  it("constrains every phase-1 select to the dictionary's allowed values", async () => {
    for (const x of phase1.filter((y) => y.type === "Select" && y.allowed.length > 0)) {
      const col = columnOnItems(x);
      if (!col || x.mode !== "editable") continue;
      for (const v of x.allowed) {
        const id = await fresh();
        await db.admin.query(`update public.items set ${col} = $1 where id = $2`, [v, id]);
      }
      const id = await fresh();
      expect(await errorCode(db.admin.query(`update public.items set ${col} = 'not in the list' where id = $1`, [id])), x.key).toBe(CHECK);
    }
  });

  it("stores confidence as High / Medium / Low and health with Blocked", async () => {
    const id = await fresh();
    await db.admin.query("update public.items set confidence = 'Medium', health = 'Blocked' where id = $1", [id]);
    expect(await errorCode(db.admin.query("update public.items set confidence = '70' where id = $1", [id]))).toBe(CHECK);
  });
});

describe("who may write which field (editing mode of the dictionary)", () => {
  it("signed-in users can update exactly the editable stored columns", async () => {
    for (const x of phase1) {
      const col = columnOnItems(x);
      if (!col || x.key === "stack_rank") continue;
      const { rows } = await db.admin.query("select has_column_privilege('authenticated', 'public.items', $1, 'update') as ok", [col]);
      expect(rows[0].ok, `${x.key} (${x.mode})`).toBe(x.editable);
    }
  });
  it("computed, system-set and GitHub-driven columns reject writes from a creator", async () => {
    const id = await fresh();
    for (const set of ["last_edited_at = now()", "ai_draft = true", "phase_changed_at = now()", "start_building = current_date",
      "status = 'Backlog'", "delivery_progress_pct = 10", "previous_rank = 1", "created_via = 'UI'"]) {
      expect(await errorCode(db.asUser(creator, (q) => q(`update public.items set ${set} where id = $1`, [id]))), set).toBe(DENIED);
    }
  });
  it("viewers cannot edit any field", async () => {
    const id = await fresh();
    const n = await db.asUser(viewer, async (q) => (await q("update public.items set hypothesis = 'x' where id = $1", [id])).rowCount, { commit: true });
    expect(n).toBe(0);
  });
});

describe("item codes", () => {
  it("keep counting past R-99 without repeating (R-100, R-101, ...)", async () => {
    await db.admin.query("update pv_internal.item_counters set last_number = 98 where tenant_id = $1", [f.tenantB]);
    const codes: string[] = [];
    for (let i = 0; i < 4; i++) {
      codes.push((await db.admin.query("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, 'Code', $2) returning item_code", [f.tenantB, f.seedB.project])).rows[0].item_code);
    }
    expect(codes).toEqual(["R-99", "R-100", "R-101", "R-102"]);
  });
});

describe("people fields cannot point outside the tenant", () => {
  it("rejects a sponsor from another tenant", async () => {
    const id = await fresh();
    expect(await errorCode(db.asUser(creator, (q) => q("update public.items set sponsor = $1 where id = $2", [f.bob, id])))).toBe(FK);
  });
  it("accepts a member of the tenant", async () => {
    const id = await fresh();
    const n = await db.asUser(creator, async (q) => (await q("update public.items set sponsor = $1, designer = $1 where id = $2", [viewer, id])).rowCount, { commit: true });
    expect(n).toBe(1);
  });
});

describe("audit: one row per changed field, including the new columns", () => {
  it("writes an audit row for each new column that changed, with actor and source", async () => {
    const id = await fresh();
    await db.asUser(creator, (q) => q("update public.items set hypothesis = 'We think X', audience = 'Internal', kr_target = 12.5, next_review_date = '2027-01-31', archived = true where id = $1", [id]), { via: "UI", commit: true });
    const { rows } = await db.admin.query("select field, old, new, via, actor_id from public.audit_log where entity = 'items' and entity_id = $1 order by at, field", [id]);
    for (const [field, value] of [["hypothesis", "We think X"], ["audience", "Internal"], ["kr_target", 12.5], ["next_review_date", "2027-01-31"], ["archived", true]] as const) {
      expect(rows.filter((r) => r.field === field).at(-1), field).toMatchObject({ new: value, via: "UI", actor_id: creator });
    }
  });
});

describe("system-set fields", () => {
  it("records who and when last edited", async () => {
    const id = await fresh();
    await db.asUser(creator, (q) => q("update public.items set hypothesis = 'edited' where id = $1", [id]), { commit: true });
    const row = (await db.admin.query("select last_edited_by, last_edited_at from public.items where id = $1", [id])).rows[0];
    expect(row.last_edited_by).toBe(creator);
    expect(row.last_edited_at).not.toBeNull();
  });
  it("sets the phase change time and the first start date of a phase", async () => {
    const id = await fresh();
    await db.asUser(creator, (q) => q("update public.items set initiative_phase = 'Build' where id = $1", [id]), { commit: true });
    const row = (await db.admin.query("select phase_changed_at, start_building, start_discovery from public.items where id = $1", [id])).rows[0];
    expect(row.phase_changed_at).not.toBeNull();
    expect(row.start_building).not.toBeNull();
    expect(row.start_discovery).toBeNull();
    await db.admin.query("update public.items set start_building = '2020-01-01' where id = $1", [id]);
    await db.asUser(creator, (q) => q("update public.items set initiative_phase = 'Beta-test' where id = $1", [id]), { commit: true });
    await db.asUser(creator, (q) => q("update public.items set initiative_phase = 'Build' where id = $1", [id]), { commit: true });
    expect((await db.admin.query("select to_char(start_building, 'YYYY-MM-DD') as d from public.items where id = $1", [id])).rows[0].d).toBe("2020-01-01");
  });
  it("does not count a re-rank as an edit of the items that shifted", async () => {
    const b = await fresh();
    const last = await fresh();
    // (the trigger stamps every normal update, so backdate inside the same "rank internal" switch a re-rank uses)
    await db.admin.query(`select set_config('pv.rank_internal', 'on', true); update public.items set last_edited_at = '2020-01-01' where id = '${b}'`);
    await db.asUser(f.alice, (q) => q("select public.move_item($1, 1)", [last]), { commit: true });
    expect((await db.admin.query("select to_char(last_edited_at, 'YYYY') as y from public.items where id = $1", [b])).rows[0].y).toBe("2020");
  });
});

describe("related tables", () => {
  it("lets creators add tags, links, files and relations, and viewers only read", async () => {
    const [a, b] = f.seedA.items;
    await db.asUser(creator, async (q) => {
      await q("insert into public.item_tags (tenant_id, item_id, kind, value) values ($1, $2, 'target_scope', 'EU')", [f.tenantA, a]);
      await q("insert into public.item_links (tenant_id, item_id, label, url) values ($1, $2, 'Spec', 'https://example.test/spec')", [f.tenantA, a]);
      await q("insert into public.item_files (tenant_id, item_id, name, storage_path) values ($1, $2, 'a.png', 'p/a.png')", [f.tenantA, a]);
      await q("insert into public.item_relations (tenant_id, item_id, related_item_id, kind) values ($1, $2, $3, 'related_to')", [f.tenantA, a, b]);
    }, { commit: true, via: "UI" });
    expect(await errorCode(db.asUser(viewer, (q) => q("insert into public.item_tags (tenant_id, item_id, kind, value) values ($1, $2, 'tag', 'nope')", [f.tenantA, a])))).toBe(DENIED);
    expect(await db.asUser(viewer, async (q) => (await q("select 1 from public.item_tags where tenant_id = $1", [f.tenantA])).rowCount)).toBeGreaterThan(0);
    const audited = await db.admin.query("select distinct entity from public.audit_log where entity in ('item_tags','item_links','item_files','item_relations') and tenant_id = $1", [f.tenantA]);
    expect(audited.rows.map((r) => r.entity).sort()).toEqual(["item_files", "item_links", "item_relations", "item_tags"]);
  });
  it("refuses duplicates, self relations, bad links and cross-tenant references", async () => {
    const [a] = f.seedA.items;
    expect(await errorCode(db.asUser(creator, (q) => q("insert into public.item_tags (tenant_id, item_id, kind, value) values ($1, $2, 'tag', 'priority')", [f.tenantA, a])))).toBe(UNIQUE);
    expect(await errorCode(db.asUser(creator, (q) => q("insert into public.item_relations (tenant_id, item_id, related_item_id, kind) values ($1, $2, $2, 'depends_on')", [f.tenantA, a])))).toBe(CHECK);
    expect(await errorCode(db.asUser(creator, (q) => q("insert into public.item_links (tenant_id, item_id, url) values ($1, $2, 'javascript:alert(1)')", [f.tenantA, a])))).toBe(CHECK);
    expect(await errorCode(db.asUser(creator, (q) => q("insert into public.item_relations (tenant_id, item_id, related_item_id, kind) values ($1, $2, $3, 'depends_on')", [f.tenantA, a, f.seedB.items[0]])))).toBe(FK);
    expect(await errorCode(db.asUser(creator, (q) => q("insert into public.item_tags (tenant_id, item_id, kind, value) values ($1, $2, 'tag', 'x')", [f.tenantA, f.seedB.items[0]])))).toBe(FK);
  });
  it("removes tags and links with the item", async () => {
    const id = await fresh();
    await db.admin.query("insert into public.item_tags (tenant_id, item_id, kind, value) values ($1, $2, 'tag', 'gone')", [f.tenantA, id]);
    await db.admin.query("delete from public.items where id = $1", [id]);
    expect((await db.admin.query("select 1 from public.item_tags where item_id = $1", [id])).rowCount).toBe(0);
  });
});

describe("computed fields (view items_computed)", () => {
  const computed = FIELDS.filter((x) => x.storage.startsWith("Computed"));

  it("has one column per computed field of the dictionary", async () => {
    const have = (await columns("items_computed")).filter((c) => c !== "id" && c !== "tenant_id").sort();
    expect(have).toEqual(computed.map((x) => x.key).sort());
    expect(computed.length).toBe(30);
  });
  it("returns a row per item and calculates what it can", async () => {
    const id = await fresh();
    await db.admin.query(
      `update public.items set value_12m = 100000, confidence = 'High', estimate_high_weeks = 10, g2m_date_est = '2027-05-20', start_date = '2027-01-01',
         start_discovery = '2027-01-01', start_definition = '2027-01-15', start_building = '2027-02-01', start_beta = '2027-03-15', g2m_date_actual = '2027-04-01',
         next_review_date = '2020-01-01' where id = $1`, [id]);
    const r = (await db.admin.query("select * from public.items_computed where id = $1", [id])).rows[0];
    expect(Number(r.value_weighted)).toBe(90000);
    expect(Number(r.value_weighted_per_build_week)).toBe(9000);
    expect(r.g2m_quarter).toBe("Q2 2027");
    expect(r.time_discovery_days).toBe(14);
    expect(r.time_building_days).toBe(42);
    expect(Number(r.actual_build_weeks)).toBe(6);
    expect(Number(r.build_vs_estimate_high_pct)).toBe(60);
    expect(r.time_to_market_days).toBe(90);
    expect(r.review_overdue).toBe(true);
    expect(r.item_age_days).toBe(0);
    expect(r.project_rank).toBeGreaterThan(0);
    expect(r.crowd_rank).toBeNull(); // arrives with alignment sessions
    expect(r.locked_by_source).toBe(false);
  });
  it("ranks items within their project from the global rank", async () => {
    const rows = (await db.admin.query("select i.stack_rank, c.project_rank from public.items i join public.items_computed c on c.id = i.id where i.tenant_id = $1 and i.home_project_id = $2 order by i.stack_rank", [f.tenantA, f.seedA.project])).rows;
    expect(rows.map((r) => r.project_rank)).toEqual(rows.map((_, i) => i + 1));
  });
  it("shows a user only the rows of their own tenant", async () => {
    const seen = await db.asUser(f.alice, async (q) => (await q("select distinct tenant_id from public.items_computed")).rows.map((r) => r.tenant_id));
    expect(seen).toEqual([f.tenantA]);
    expect((await db.asUser(f.bob, async (q) => (await q("select 1 from public.items_computed where tenant_id = $1", [f.tenantA])).rowCount))).toBe(0);
    expect(await errorCode(db.asAnon((q) => q("select * from public.items_computed")))).toBe(DENIED);
  });
});

describe("the registry knows every column it claims", () => {
  it("lists status as locked and a column that really exists", async () => {
    expect(FIELD_BY_KEY.status!.mode).toBe("locked");
    expect(await columns("items")).toContain("status");
  });
});
