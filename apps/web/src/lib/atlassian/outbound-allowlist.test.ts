import { describe, expect, it } from "vitest";
import { FIELDS } from "@pv/domain";
import { buildJiraPayload, desiredLabels, mergeLabels, OUTBOUND_JIRA_FIELDS } from "./outbound";

// CLAUDE.md rule 2, issue #67: commercial fields never reach Jira. Every dictionary field gets a unique sentinel; only the allowlisted
// ones may appear anywhere in what would be sent. Same style as apps/web/src/lib/github/outbound-allowlist.test.ts. Part of `pnpm test`.
const allowed = new Set<string>(OUTBOUND_JIRA_FIELDS);
const sentinel = (key: string) => `LEAK_${key.toUpperCase()}_9f3a`;
const OTHER = ["id", "tenant_id", "home_project_id", "created_by", "owner_user_id"];
const fullItem = () => ({ ...Object.fromEntries([...FIELDS.map((f) => f.key), ...OTHER].map((k) => [k, sentinel(k)])), moscow: "Must", g2m_date_est: "2027-03-31", planned_start: "2027-01-04" });
const FIELDS_MAP = { startDate: "customfield_10015", theme: "customfield_10030", priorityByMoscow: { Must: "1" } };

describe("outbound Jira payloads", () => {
  it("serialises nothing but allowlisted fields, even when every field of the item is filled (create and update)", () => {
    for (const create of [{ projectKey: "PLAT", issueTypeId: "10000" }, undefined]) {
      const w = JSON.stringify(buildJiraPayload({ item: fullItem(), fields: FIELDS_MAP, create, parentKey: "PLAT-1", currentLabels: ["mine"] }));
      for (const f of FIELDS) if (!allowed.has(f.key)) expect(w, `${f.key} leaked into a Jira payload`).not.toContain(sentinel(f.key));
      for (const k of OTHER) expect(w, `${k} leaked`).not.toContain(sentinel(k));
      expect(w).toContain(sentinel("initiative_name"));
      expect(w).toContain(sentinel("description"));
    }
  });

  it("never sends a person field or the address of a person named without an account (issue #691)", () => {
    const people = FIELDS.filter((f) => f.type === "Person").map((f) => f.key);
    for (const k of people) expect(allowed.has(k), `${k} is a person field and must not be read for a payload`).toBe(false);
    const item = { ...fullItem(), product_manager: "jane.doe@leak.example", engineering_manager: "Jane Doe <jane.doe@leak.example>" };
    for (const create of [{ projectKey: "PLAT", issueTypeId: "10000" }, undefined]) {
      const w = JSON.stringify(buildJiraPayload({ item, fields: FIELDS_MAP, create, parentKey: "PLAT-1", currentLabels: [] }));
      expect(w).not.toContain("jane.doe@leak.example");
      expect(w).not.toContain("Jane Doe");
    }
  });

  it("never reads a field outside the allowlist from the item", () => {
    const read: string[] = [];
    const item = new Proxy(fullItem(), { get: (t, k) => (read.push(String(k)), (t as Record<string, unknown>)[String(k)]) });
    buildJiraPayload({ item, fields: FIELDS_MAP });
    expect(read.filter((k) => !allowed.has(k))).toEqual([]);
  });

  it("the allowlist holds no commercial field and only dictionary fields", () => {
    const commercial = ["value", "value_12m", "value_basis", "confidence", "customers_requesting", "target_customers", "decision", "decided_by", "decision_date", "cost_of_not_doing", "kr_metric", "kr_start", "kr_target", "kr_unit", "kr_direction", "value_proposition", "time_to_first_revenue_months", "target_markets", "live_markets", "outcomes", "build_status"];
    for (const k of commercial) expect(allowed.has(k), k).toBe(false);
    for (const k of OUTBOUND_JIRA_FIELDS) expect(FIELDS.some((f) => f.key === k)).toBe(true);
  });

  it("never writes a status, a transition or a sprint: the payload has only the fields PV may set", () => {
    const f = buildJiraPayload({ item: fullItem(), fields: FIELDS_MAP, create: { projectKey: "PLAT", issueTypeId: "10000" } }).fields;
    expect(Object.keys(f).sort()).toEqual(["customfield_10015", "customfield_10030", "description", "duedate", "issuetype", "labels", "priority", "project", "summary"]);
    expect(JSON.stringify(f)).not.toMatch(/status|transition|sprint|resolution|assignee/i);
  });

  it("labels match the GitHub sync: project, MoSCoW, rank band, Change Type and Initiative Group; the rank number never leaves", () => {
    const p = buildJiraPayload({ item: { ...fullItem(), moscow: "Should", stack_rank: 37, change_type: "Feature", theme: "Advertiser experience" }, fields: {}, projectName: "JIRA test" });
    expect(p.fields.labels).toEqual(["pm:project/jira-test", "pm:moscow/should", "pm:rank/top-50", "pm:type/new-feature", "pm:group/advertiser-experience", "pm:value/leak-value-type-9f3a", "pm:phase/leak-initiative-phase-9f3a"]);
    expect(JSON.stringify(p)).not.toMatch(/\b37\b/);
  });
  it("MoSCoW leaves only as a pv: label (and a chosen priority id); the rank number never leaves", () => {
    const p = buildJiraPayload({ item: { ...fullItem(), moscow: "Should", stack_rank: 37 }, fields: {} });
    expect(p.fields.labels).toEqual(["pm:moscow/should", "pm:rank/top-50", "pm:group/leak-theme-9f3a", "pm:value/leak-value-type-9f3a", "pm:phase/leak-initiative-phase-9f3a"]);
    expect(JSON.stringify(p)).not.toMatch(/\b37\b/);
    expect(p.fields.priority).toBeUndefined();
    expect(p.notes.join(" ")).toMatch(/Priority not sent/);
  });

  it("a hostile description stays text inside ADF; people's labels are kept and stale pv: labels are removed", () => {
    const p = buildJiraPayload({ item: { ...fullItem(), description: "<script>alert(1)</script> [x](javascript:alert(1))" }, fields: {}, currentLabels: ["team-a", "pm:moscow/could"] });
    expect(JSON.stringify(p.fields.description)).not.toContain('"href":"javascript');
    expect(p.fields.labels).toEqual(["team-a", "pm:moscow/must", "pm:group/leak-theme-9f3a", "pm:value/leak-value-type-9f3a", "pm:phase/leak-initiative-phase-9f3a"]);
    expect(desiredLabels({})).toEqual([]);
    expect(mergeLabels(["a", "pv:x", "product-velocity", "pm:y"], [])).toEqual(["a"]);
  });

  it("an unmapped start date is skipped with a note, never guessed", () => {
    const p = buildJiraPayload({ item: fullItem(), fields: {} });
    expect(Object.keys(p.fields).some((k) => k.startsWith("customfield"))).toBe(false);
    expect(p.notes.join(" ")).toMatch(/Start date not sent/);
  });

  it("sends the Focus Area as plain one-line text into the mapped Theme field, and nothing else commercial with it", () => {
    const p = buildJiraPayload({ item: { ...fullItem(), focus_area: "  Growth\u0000 &\n<b>Retention</b>\t" }, fields: FIELDS_MAP });
    expect(p.fields.customfield_10030).toBe("Growth & <b>Retention</b>");
    expect(p.notes.join(" ")).not.toMatch(/Theme not sent/);
    const long = buildJiraPayload({ item: { ...fullItem(), focus_area: "x".repeat(900) }, fields: FIELDS_MAP });
    expect((long.fields.customfield_10030 as string).length).toBe(255);
  });

  it("an unmapped Theme is skipped with a note (the group label is still sent); no focus area means nothing to send and no note; the group never goes into a field", () => {
    const p = buildJiraPayload({ item: fullItem(), fields: { startDate: "customfield_10015" } });
    expect(Object.keys(p.fields).filter((k) => k.startsWith("customfield"))).toEqual(["customfield_10015"]);
    expect(p.notes.join(" ")).toMatch(/Theme not sent/);
    expect(p.fields.labels).toContain("pm:group/leak-theme-9f3a");
    const none = buildJiraPayload({ item: { ...fullItem(), focus_area: "" }, fields: FIELDS_MAP });
    expect(JSON.stringify(buildJiraPayload({ item: fullItem(), fields: FIELDS_MAP }).fields)).not.toContain("LEAK_THEME");
    expect(none.fields.customfield_10030).toBeUndefined();
    expect(none.notes.join(" ")).not.toMatch(/Theme not sent/);
  });

  it("a malformed Theme field id never reaches the payload", () => {
    const p = buildJiraPayload({ item: fullItem(), fields: { theme: "summary" } });
    expect(p.fields.summary).not.toContain("LEAK_THEME");
    expect(p.notes.join(" ")).toMatch(/Theme not sent/);
  });
});

describe("a custom field configuration can not make a non-allowlisted field appear (decision 2026-11-03-tracker-field-config)", () => {
  const CUSTOM_MAPS = [
    { ...FIELDS_MAP, dueDate: "customfield_10016" },
    { ...FIELDS_MAP, off: ["jira.dueDate", "jira.label.moscow", "jira.label.rank", "jira.label.type", "jira.label.group", "jira.label.project"] },
    // hostile values in a map that was stored by hand: ids that name nothing of ours, slot names of commercial fields
    { startDate: "customfield_10015", dueDate: "customfield_10015", off: ["value_12m", "confidence", "decision"] },
  ];
  it.each(CUSTOM_MAPS.map((m, n) => [n, m] as const))("map %i: nothing but allowlisted fields is serialised", (_n, map) => {
    const w = JSON.stringify(buildJiraPayload({ item: fullItem(), fields: map, create: { projectKey: "PLAT", issueTypeId: "10000" }, projectName: "Platform", currentLabels: ["mine"] }));
    for (const f of FIELDS) if (!allowed.has(f.key)) expect(w, `${f.key} leaked into a Jira payload`).not.toContain(sentinel(f.key));
    for (const k of OTHER) expect(w, `${k} leaked`).not.toContain(sentinel(k));
  });
  it("a due date field that is not a field id is ignored: it can only be duedate or a custom field", () => {
    const f = buildJiraPayload({ item: fullItem(), fields: { dueDate: "description" } }).fields;
    expect(f.duedate).toBe("2027-03-31");
    expect(JSON.stringify(f.description)).not.toContain("2027-03-31");
  });
});

describe("select fields (issue #512)", () => {
  const selects = { "jira.select.health": { field: "customfield_10100", direction: "two_way" as const, options: { "At Risk": "202" } }, "jira.select.initiative_status": { field: "customfield_10101", direction: "two_way" as const, options: { Active: "211" } }, "jira.select.initiative_phase": { field: "customfield_10102", direction: "to_jira" as const, options: { Build: "221" } } };
  it("writes Health, Initiative Status and Initiative Phase only as option ids on the mapped custom fields", () => {
    const f = buildJiraPayload({ item: { ...fullItem(), health: "At Risk", initiative_status: "Active", initiative_phase: "Build" }, fields: { selects } }).fields;
    expect(f.customfield_10100).toEqual({ id: "202" });
    expect(f.customfield_10101).toEqual({ id: "211" });
    expect(f.customfield_10102).toEqual({ id: "221" });
    expect(Object.keys(f)).not.toContain("status");
  });
  it("sends nothing for them while no select slot is mapped", () => {
    const f = buildJiraPayload({ item: { ...fullItem(), health: "At Risk", initiative_status: "Active", initiative_phase: "Build" }, fields: {} }).fields;
    expect(Object.keys(f).filter((k) => k.startsWith("customfield_"))).toEqual([]);
  });
  it("a hostile selects map cannot make a commercial field appear: the slots are closed", () => {
    const hostile = { ...selects, "jira.select.value_12m": { field: "customfield_10199", direction: "to_jira", options: {} } } as never;
    const w = JSON.stringify(buildJiraPayload({ item: { ...fullItem(), health: "At Risk" }, fields: { selects: hostile } }));
    for (const f of FIELDS) if (!allowed.has(f.key)) expect(w, `${f.key} leaked`).not.toContain(sentinel(f.key));
    expect(w).not.toContain("customfield_10199");
  });
});
