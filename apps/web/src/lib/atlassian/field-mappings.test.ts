import { describe, expect, it } from "vitest";
import { buildFieldCatalog } from "./field-catalog";
import { SAMPLE, SITE_FIELDS } from "./field-fixtures";
import { loadFieldMappings, parseCatalogRows, parseMappingRows, type MappingReader } from "./field-mappings";
import { buildFieldsView } from "./field-section";
import { OUTBOUND_JIRA_FIELDS } from "./outbound";
import { COMMERCIAL_FIELDS, JIRA_TARGETS } from "@pv/domain";

const catalog = () => buildFieldCatalog(SITE_FIELDS, SAMPLE);

const row = (o: Record<string, unknown>) => ({ jira_field_id: "customfield_10015", jira_field_name: "Start date", jira_kind: "date", jira_custom: true, pv_field: "planned_start", direction: "read", ...o });

describe("loading the mappings of a link", () => {
  it("returns valid rows with the read and write halves separated", async () => {
    const calls: string[] = [];
    const db: MappingReader = {
      from: (t) => ({ select: () => ({ eq: async (col, v) => { calls.push(`${t}|${col}=${v}`); return { data: [row({}), row({ jira_field_id: "duedate", jira_field_name: "Due date", jira_custom: false, pv_field: "g2m_date_est", direction: "two_way" })], error: null }; } }) }),
    };
    const m = await loadFieldMappings(db, "link-1");
    expect(calls).toEqual(["jira_field_mappings|link_id=link-1"]);
    expect(m.all.map((x) => x.pvField)).toEqual(["planned_start", "g2m_date_est"]);
    expect(m.readable).toHaveLength(2);
    expect(m.writable.map((x) => x.jiraFieldId)).toEqual(["duedate"]);
    expect(m.byJiraField.get("customfield_10015")?.pvField).toBe("planned_start");
    expect(m.byPvField.get("g2m_date_est")?.jiraKind).toBe("date");
  });
  it("throws when the database cannot be read, instead of pretending nothing is mapped", async () => {
    const db: MappingReader = { from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { message: "boom" } }) }) }) };
    await expect(loadFieldMappings(db, "l")).rejects.toThrow(/Could not read/);
  });
  it("drops rows the shared rules do not allow, malformed rows and duplicates (defence in depth)", () => {
    const rows = [
      row({}),
      row({ jira_field_id: "customfield_1", pv_field: "value_12m", jira_kind: "number" }), // commercial
      row({ jira_field_id: "customfield_2", pv_field: "status", jira_kind: "select" }), // tracker driven
      row({ jira_field_id: "customfield_3", pv_field: "initiative_status", jira_kind: "select" }),
      row({ jira_field_id: "customfield_4", pv_field: "effort", jira_kind: "number" }), // incompatible
      row({ jira_field_id: "customfield_5", pv_field: "estimate_low_weeks", jira_kind: "number", direction: "two_way" }), // two-way not allowed
      row({ jira_field_id: "customfield_6", pv_field: "no_such_field" }),
      row({ jira_field_id: "customfield_7", direction: "sideways" }),
      row({ jira_field_id: "customfield_8", jira_kind: "weird" }),
      row({ jira_field_id: "customfield_9" }), // same PV field again: only the first stays
      null, "x", { jira_field_id: 5 },
    ];
    expect(parseMappingRows(rows).map((x) => x.jiraFieldId)).toEqual(["customfield_10015"]);
    expect(parseMappingRows("nope")).toEqual([]);
  });
});

describe("the cached catalog", () => {
  it("round-trips through jsonb and tolerates a stale or damaged cache", () => {
    const rows = catalog();
    expect(parseCatalogRows(JSON.parse(JSON.stringify(rows)))).toEqual(rows);
    expect(parseCatalogRows(null)).toEqual([]);
    expect(parseCatalogRows([{ id: 1 }, { id: "x", name: "X", kind: "mystery" }])).toEqual([{ id: "x", name: "X", custom: false, kind: "other", role: null, filled: 0, sampled: 0 }]);
  });
  it("keeps the two fields named Vulnerability apart (ids, not names)", () => {
    const v = catalog().filter((r) => r.name === "Vulnerability");
    expect(v.map((r) => [r.id, r.kind]).sort()).toEqual([["customfield_10100", "select"], ["customfield_10101", "text"]]);
  });
  it("reads Team and Parent as objects with their own kind, not as 'other'", () => {
    const k = Object.fromEntries(catalog().map((r) => [r.id, r.kind]));
    expect(k.customfield_10001).toBe("team");
    expect(k.parent).toBe("parent");
    expect(k.customfield_10200).toBe("other");
  });
});

describe("the Fields section", () => {
  const stored = parseMappingRows([row({})]);
  const view = buildFieldsView({ rows: catalog(), mappings: stored, refreshedAt: "2026-11-03T10:00:00Z", error: null, sampled: 2 });
  const get = (id: string) => view.rows.find((r) => r.id === id)!;

  it("lists every field of the site, mapped ones first", () => {
    expect(view.rows).toHaveLength(SITE_FIELDS.length);
    expect(view.mappedCount).toBe(1);
    expect(view.rows[0]!.id).toBe("customfield_10015");
    expect(get("customfield_10015").mapped).toMatchObject({ pv: "planned_start", pvLabel: "Planned Start", direction: "read" });
    expect(get("customfield_10015")).toMatchObject({ filled: 1, sampled: 2 });
  });
  it("unmapped fields are visible and say they are ignored (no mapping)", () => {
    for (const r of view.rows.filter((x) => x.id !== "customfield_10015")) expect(r.mapped, r.id).toBeNull();
  });
  it("offers only valid choices, with the direction in words", () => {
    expect(get("customfield_10015").targets.map((t) => t.value)).toEqual(["planned_start:read", "planned_start:two_way", "g2m_date_est:read", "g2m_date_est:two_way"]);
    expect(get("customfield_10001").targets).toEqual([{ value: "contributing_teams:read", label: "Contributing Teams (read only)" }]);
    expect(get("labels").targets.map((t) => t.value)).toEqual(["tags:read", "contributing_teams:read"]);
    expect(get("customfield_10016").targets).toEqual([{ value: "estimate_low_weeks:read", label: expect.any(String) }, { value: "estimate_high_weeks:read", label: expect.any(String) }]);
  });
  it("says clearly what is not mappable", () => {
    expect(get("status").targets).toEqual([]);
    expect(get("status").unmappableReason).toMatch(/never mapped/);
    expect(get("customfield_10200").unmappableReason).toMatch(/cannot read this kind of value yet/);
    expect(get("parent").unmappableReason).toMatch(/No Product Velocity field takes a parent issue/);
    expect(get("customfield_10020").unmappableReason).toMatch(/sprints/);
    expect(get("summary").unmappableReason).toMatch(/always synced/);
  });
  it("suggests from the role hints but never applies one, and not where a mapping exists", () => {
    expect(get("customfield_10001").suggestion).toMatchObject({ pv: "contributing_teams", direction: "read" });
    expect(get("customfield_10001").mapped).toBeNull();
    expect(get("customfield_10016").suggestion).toBeNull(); // story points: no fitting field
    expect(get("customfield_10015").suggestion).toBeNull(); // already mapped
    expect(get("labels").suggestion).toMatchObject({ pv: "tags" });
  });
  it("marks a list older than a week as stale", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    expect(buildFieldsView({ rows: [], mappings: [], refreshedAt: "2026-11-03T10:00:00Z", error: null, sampled: 0, now }).stale).toBe(true);
    expect(buildFieldsView({ rows: [], mappings: [], refreshedAt: "2026-11-05T10:00:00Z", error: null, sampled: 0, now }).stale).toBe(false);
    expect(buildFieldsView({ rows: [], mappings: [], refreshedAt: null, error: null, sampled: 0, now }).stale).toBe(false);
  });
  it("keeps a mapping visible when its Jira field is gone from the catalog, so it can be removed", () => {
    const gone = buildFieldsView({ rows: catalog().filter((r) => r.id !== "customfield_10015"), mappings: stored, refreshedAt: null, error: null, sampled: 0 });
    expect(gone.rows[0]).toMatchObject({ id: "customfield_10015", missing: true, mapped: { pv: "planned_start" } });
  });
});

describe("the mapping and the outbound allowlist agree (CLAUDE.md rule 2)", () => {
  it("a field may be two-way exactly when the Jira outbound allowlist already sends it (name and description are always synced, not mapped)", () => {
    const sent = OUTBOUND_JIRA_FIELDS.filter((k) => k !== "initiative_name" && k !== "description").sort();
    expect(JIRA_TARGETS.filter((t) => t.twoWay).map((t) => t.pv).sort()).toEqual(sent);
  });
  it("no commercial field is on the outbound allowlist or is a mapping target", () => {
    for (const k of COMMERCIAL_FIELDS) {
      expect((OUTBOUND_JIRA_FIELDS as readonly string[]).includes(k), k).toBe(false);
      expect(JIRA_TARGETS.some((t) => t.pv === k), k).toBe(false);
    }
  });
});
