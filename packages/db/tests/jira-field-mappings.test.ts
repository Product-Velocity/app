import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIELDS, JIRA_KINDS, validateJiraMapping } from "@pv/domain";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Jira field catalog cache and field mapping per project link (issues #69, #70): jira_field_catalogs, jira_field_mappings,
// jira_set_field_mapping, jira_remove_field_mapping and jira_mapping_check.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string, service: string;
let projectA: string, linkA: string, projectB: string;
const DENIED = "42501";
const REFUSED = "PV011";
const TAKEN = "PV012";
const NOT_LINKED = "P0002";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-fm@example.test");
  viewer = await createUser(db, "viewer-fm@example.test");
  service = await createUser(db, "service-fm@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  await addMember(db, f.alice, f.tenantA, service, "admin", { serviceAccount: true });
  const a = (await db.admin.query("select id, project_id from public.jira_project_links where tenant_id = $1", [f.tenantA])).rows[0];
  projectA = a.project_id as string;
  linkA = a.id as string;
  projectB = (await db.admin.query("select project_id from public.jira_project_links where tenant_id = $1", [f.tenantB])).rows[0].project_id as string;
  await clear();
});
afterAll(async () => { await db.close(); });

const clear = () => db.admin.query("delete from public.jira_field_mappings");
const rows = async (project = projectA) => (await db.admin.query("select m.* from public.jira_field_mappings m join public.jira_project_links l on l.id = m.link_id where l.project_id = $1 order by m.jira_field_id", [project])).rows;
type M = { id?: string; name?: string; kind?: string; custom?: boolean; pv?: string; dir?: string; via?: string };
const set = (user: string, project: string, m: M = {}) =>
  db.asUser(
    user,
    async (q) => (await q("select public.jira_set_field_mapping($1, $2, $3, $4, $5, $6, $7) as id", [project, m.id ?? "customfield_10015", m.name ?? "Start date", m.kind ?? "date", m.custom ?? true, m.pv ?? "planned_start", m.dir ?? "read"])).rows[0].id as string,
    { commit: true, via: m.via ?? "UI" },
  );
const remove = (user: string, project: string, id: string, via = "UI") => db.asUser(user, (q) => q("select public.jira_remove_field_mapping($1, $2)", [project, id]), { commit: true, via });
async function refusal(p: Promise<unknown>) {
  try { await p; return null; } catch (e) { const x = e as { code?: string; hint?: string }; return { code: x.code ?? null, hint: x.hint ?? null }; }
}

describe("mapping a Jira field to a PV field", () => {
  it("a human admin maps by field id; it is stored with Jira's name and kind, and audited with actor and source", async () => {
    await clear();
    const id = await set(f.alice, projectA);
    const [row] = await rows();
    expect(row).toMatchObject({ id, jira_field_id: "customfield_10015", jira_field_name: "Start date", jira_kind: "date", jira_custom: true, pv_field: "planned_start", direction: "read", created_by: f.alice, created_via: "UI" });
    const audit = (await db.admin.query("select field, new, actor_id, via from public.audit_log where entity = 'jira_field_mappings' and entity_id = $1", [id])).rows;
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.find((a) => a.field === "pv_field")).toMatchObject({ actor_id: f.alice, via: "UI" });
  });

  it("choosing another PV field for the same Jira field replaces the mapping (an update, audited with old and new)", async () => {
    await clear();
    const id = await set(f.alice, projectA);
    expect(await set(f.alice, projectA, { pv: "g2m_date_est", dir: "two_way" })).toBe(id);
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ pv_field: "g2m_date_est", direction: "two_way" });
    const a = (await db.admin.query("select old, new from public.audit_log where entity = 'jira_field_mappings' and entity_id = $1 and field = 'pv_field' order by id", [id])).rows;
    expect(a.at(-1)).toMatchObject({ old: "planned_start", new: "g2m_date_est" });
  });

  it("two Jira fields with the same name are two mappings (ids, not names)", async () => {
    await clear();
    await set(f.alice, projectA, { id: "customfield_10100", name: "Vulnerability", kind: "select", pv: "effort" });
    await set(f.alice, projectA, { id: "customfield_10101", name: "Vulnerability", kind: "select", pv: "horizon" });
    expect(await rows()).toHaveLength(2);
  });

  it("one PV field maps from at most one Jira field per link", async () => {
    await clear();
    await set(f.alice, projectA);
    expect(await errorCode(set(f.alice, projectA, { id: "customfield_10099", name: "Kickoff" }))).toBe(TAKEN);
    expect(await rows()).toHaveLength(1);
    expect(await errorCode(db.admin.query("insert into public.jira_field_mappings (tenant_id, link_id, jira_field_id, jira_field_name, jira_kind, jira_custom, pv_field, direction) values ($1, $2, 'customfield_10099', 'x', 'date', true, 'planned_start', 'read')", [f.tenantA, linkA]))).toBe("23505");
  });

  it("the same Jira field and PV field can be mapped in another link or workspace", async () => {
    await clear();
    await set(f.alice, projectA);
    await set(f.bob, projectB);
    expect(await rows(projectB)).toHaveLength(1);
  });

  it("refuses with the reason code: commercial, person-only, tracker-driven, status, private, incompatible, two-way not allowed, unknown", async () => {
    await clear();
    const cases: [M, string][] = [
      [{ pv: "value_12m", kind: "number" }, "commercial"],
      [{ pv: "confidence", kind: "select", dir: "two_way" }, "commercial"],
      [{ pv: "customers_requesting", kind: "number" }, "commercial"],
      [{ pv: "decision", kind: "select" }, "commercial"],
      [{ pv: "stack_rank", kind: "number" }, "commercial"],
      [{ pv: "kr_target", kind: "number" }, "commercial"],
      [{ pv: "status", kind: "select" }, "tracker_driven"],
      [{ pv: "delivery_progress_pct", kind: "number", dir: "two_way" }, "tracker_driven"],
      [{ pv: "ci_status", kind: "text" }, "tracker_driven"],
      [{ pv: "initiative_status", kind: "select" }, "status_people_only"],
      [{ pv: "align_why", kind: "select" }, "private"],
      [{ pv: "item_code", kind: "text" }, "not_for_jira"],
      [{ pv: "no_such_field", kind: "text" }, "not_for_jira"],
      [{ pv: "planned_start", kind: "number" }, "incompatible"],
      [{ pv: "effort", kind: "number" }, "incompatible"],
      [{ pv: "estimate_low_weeks", kind: "number", dir: "two_way" }, "two_way_not_allowed"],
      [{ pv: "planned_start", id: "created", custom: false, kind: "datetime", dir: "two_way" }, "jira_read_only"],
      [{ pv: "moscow", id: "status", custom: false, kind: "select" }, "jira_unmappable"],
      [{ pv: "planned_start", dir: "sideways" }, "unknown_direction"],
      [{ pv: "planned_start", kind: "mystery" }, "unknown_kind"],
    ];
    for (const [m, code] of cases) expect(await refusal(set(f.alice, projectA, m)), JSON.stringify(m)).toEqual({ code: REFUSED, hint: code });
    expect(await rows()).toEqual([]);
  });

  it("only a human admin of the workspace: not a creator, viewer, service account, Claude, platform-style outsider or another workspace's admin", async () => {
    await clear();
    for (const u of [creator, viewer, service, f.carol, f.bob]) expect(await errorCode(set(u, projectA)), u).toBe(DENIED);
    expect(await errorCode(set(f.alice, projectA, { via: "MCP" }))).toBe(DENIED);
    expect(await rows()).toEqual([]);
    await set(f.alice, projectA);
    expect(await errorCode(remove(creator, projectA, "customfield_10015"))).toBe(DENIED);
    expect(await errorCode(remove(service, projectA, "customfield_10015"))).toBe(DENIED);
    expect(await errorCode(remove(f.bob, projectA, "customfield_10015"))).toBe(DENIED);
    expect(await errorCode(remove(f.alice, projectA, "customfield_10015", "MCP"))).toBe(DENIED);
    expect(await rows()).toHaveLength(1);
  });

  it("a project without a Jira link has no mapping", async () => {
    const p = (await db.admin.query("insert into public.projects (tenant_id, name) values ($1, 'No link') returning id", [f.tenantA])).rows[0].id as string;
    expect(await errorCode(set(f.alice, p))).toBe(NOT_LINKED);
  });

  it("an admin removes a mapping; it is audited; removing an unmapped field does nothing", async () => {
    await clear();
    const id = await set(f.alice, projectA);
    await remove(f.alice, projectA, "customfield_10015");
    await remove(f.alice, projectA, "customfield_10015");
    expect(await rows()).toEqual([]);
    expect(Number((await db.admin.query("select count(*) from public.audit_log where entity = 'jira_field_mappings' and entity_id = $1", [id])).rows[0].count)).toBeGreaterThan(1);
  });

  it("a remove for a project of another workspace cannot reach its mappings", async () => {
    await clear();
    await set(f.bob, projectB);
    await expect(remove(f.alice, projectB, "customfield_10015")).rejects.toBeDefined();
    expect(await rows(projectB)).toHaveLength(1);
  });

  it("removing the link (unlinking, disconnecting) removes its mappings and catalog", async () => {
    await clear();
    await db.admin.query("delete from public.jira_field_catalogs where link_id = $1", [linkA]);
    await db.admin.query("insert into public.jira_field_catalogs (link_id, tenant_id) values ($1, $2)", [linkA, f.tenantA]);
    await set(f.alice, projectA);
    const saved = (await db.admin.query("select * from public.jira_project_links where id = $1", [linkA])).rows[0];
    await db.admin.query("update public.item_jira_links set connection_id = connection_id where false");
    await db.admin.query("create temp table saved_ijl as select * from public.item_jira_links where tenant_id = $1", [f.tenantA]);
    await db.admin.query("delete from public.item_jira_links where tenant_id = $1", [f.tenantA]);
    await db.asUser(f.alice, (q) => q("select public.jira_unlink_project($1)", [projectA]), { commit: true });
    expect(await rows()).toEqual([]);
    expect((await db.admin.query("select 1 from public.jira_field_catalogs where link_id = $1", [linkA])).rowCount).toBe(0);
    // put the link back for the other tests
    await db.admin.query("insert into public.jira_project_links (id, tenant_id, project_id, connection_id, site_id, jira_project_id, jira_project_key, jira_project_name, initiative_type_id, initiative_type_name) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
      [saved.id, saved.tenant_id, saved.project_id, saved.connection_id, saved.site_id, saved.jira_project_id, saved.jira_project_key, saved.jira_project_name, saved.initiative_type_id, saved.initiative_type_name]);
    await db.admin.query("insert into public.item_jira_links select * from saved_ijl");
    await db.admin.query("drop table saved_ijl");
  });
});

describe("reading and writing the tables directly", () => {
  it("members read the mappings of their workspace (the sync reads them as the person); nobody writes the table", async () => {
    await clear();
    await set(f.alice, projectA);
    for (const u of [creator, viewer, f.alice]) expect(await db.asUser(u, async (q) => (await q("select pv_field from public.jira_field_mappings")).rows), u).toEqual([{ pv_field: "planned_start" }]);
    expect(await db.asUser(f.bob, async (q) => (await q("select pv_field from public.jira_field_mappings where tenant_id = $1", [f.tenantA])).rows)).toEqual([]);
    for (const sql of ["update public.jira_field_mappings set pv_field = 'moscow'", "delete from public.jira_field_mappings", "insert into public.jira_field_mappings (tenant_id, link_id, jira_field_id, jira_field_name, jira_kind, jira_custom, pv_field, direction) select tenant_id, link_id, 'x', 'x', 'date', true, 'moscow', 'read' from public.jira_field_mappings"]) {
      expect(await errorCode(db.asUser(f.alice, (q) => q(sql), { commit: true })), sql).toBe(DENIED);
    }
    expect(await rows()).toHaveLength(1);
  });

  it("the catalog is read by human admins of its workspace only (not members, service accounts or other workspaces) and written by nobody but the server", async () => {
    await db.admin.query("delete from public.jira_field_catalogs where link_id = $1", [linkA]);
    await db.admin.query("insert into public.jira_field_catalogs (link_id, tenant_id, fields, sampled) values ($1, $2, '[{\"id\":\"duedate\"}]'::jsonb, 3)", [linkA, f.tenantA]);
    const read = (u: string) => db.asUser(u, async (q) => (await q("select sampled from public.jira_field_catalogs where link_id = $1", [linkA])).rows);
    expect(await read(f.alice)).toEqual([{ sampled: 3 }]);
    for (const u of [creator, viewer, service, f.bob]) expect(await read(u), u).toEqual([]);
    expect(await errorCode(db.asUser(f.alice, (q) => q("update public.jira_field_catalogs set sampled = 0"), { commit: true }))).toBe(DENIED);
    await db.asService((q) => q("update public.jira_field_catalogs set sampled = 5 where link_id = $1", [linkA]), { commit: true });
    expect((await db.admin.query("select sampled from public.jira_field_catalogs where link_id = $1", [linkA])).rows[0].sampled).toBe(5);
  });

  it("a catalog row must belong to a link of the same workspace", async () => {
    await db.admin.query("delete from public.jira_field_catalogs where link_id = $1", [linkA]);
    expect(await errorCode(db.admin.query("insert into public.jira_field_catalogs (link_id, tenant_id) values ($1, $2)", [linkA, f.tenantB]))).toBe("23503");
  });
});

describe("the database rules equal the shared TypeScript rules", () => {
  it("every dictionary field x every Jira kind x both directions x system and custom ids gives the same verdict", async () => {
    const jiraIds: [string, boolean][] = [["customfield_10015", true], ["duedate", false], ["labels", false], ["priority", false], ["assignee", false], ["created", false], ["status", false], ["startdate", false]];
    const keys = [...FIELDS.map((x) => x.key), "no_such_field"];
    const sql = await db.admin.query("select public.jira_mapping_check($1, $2, $3, $4, $5) as v", ["customfield_1", true, "date", "planned_start", "read"]);
    expect(sql.rows[0].v).toBeNull();
    for (const [id, custom] of jiraIds) for (const kind of JIRA_KINDS) for (const pv of keys) for (const dir of ["read", "two_way"]) {
      const ts = validateJiraMapping({ id, custom, kind }, pv, dir);
      const db1 = (await db.admin.query("select public.jira_mapping_check($1, $2, $3, $4, $5) as v", [id, custom, kind, pv, dir])).rows[0].v as string | null;
      if (ts.ok) expect(db1, `${id} ${kind} ${pv} ${dir}`).toBeNull();
      else {
        expect(db1, `${id} ${kind} ${pv} ${dir}`).not.toBeNull();
        // the database cannot know that a key is not in the dictionary, so it says "not for Jira"
        expect(db1, `${id} ${kind} ${pv} ${dir}`).toBe(ts.code === "unknown_pv_field" ? "not_for_jira" : ts.code);
      }
    }
  }, 120000);
});
