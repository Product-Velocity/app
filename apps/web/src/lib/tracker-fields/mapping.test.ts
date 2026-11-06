import { buildTrackingIssue } from "@pv/github";
import { describe, expect, it } from "vitest";
import { buildJiraPayload, type JiraFieldMap } from "@/lib/atlassian/outbound";
import type { CatalogEntry } from "./catalog";
import { effectiveJiraMap, githubOptions, parseConfigRows, validateConfig, type ConfigRow } from "./mapping";
import { SLOTS, slotsFor } from "./slots";

const ITEM = { initiative_name: "Checkout redesign", description: "Plain text", moscow: "Must", stack_rank: 7, change_type: "New feature", theme: "Payments", focus_area: "Payments", g2m_date_est: "2027-03-31", planned_start: "2027-01-04", effort: "M", summary: "S", hypothesis: "H", item_code: "R-01" };
const BASE: JiraFieldMap = { startDate: "customfield_10015", theme: "customfield_10030", priorityByMoscow: { Must: "1" } };
const entry = (id: string, kind: CatalogEntry["kind"], name = id): CatalogEntry => ({ id, name, custom: id.startsWith("customfield"), kind, typeLabel: kind, options: [], filled: null, sampled: null });
const CATALOG = [entry("duedate", "date", "Due date"), entry("customfield_10015", "date", "Start date"), entry("customfield_10016", "date", "Go-live"), entry("customfield_10030", "text", "Theme"), entry("customfield_10031", "text", "Release note"), entry("customfield_10040", "select", "Team"), entry("summary", "text", "Summary")];

describe("defaults reproduce today's Jira behaviour bit for bit", () => {
  it("nothing saved means the same map and the same payload as before the field configuration existed", () => {
    expect(effectiveJiraMap(BASE, [])).toEqual(BASE);
    const before = buildJiraPayload({ item: ITEM, fields: BASE, projectName: "Platform", create: { projectKey: "PLAT", issueTypeId: "10000" } });
    const after = buildJiraPayload({ item: ITEM, fields: effectiveJiraMap(BASE, []), projectName: "Platform", create: { projectKey: "PLAT", issueTypeId: "10000" } });
    expect(after).toEqual(before);
    // the golden payload (what Sync sends today)
    expect(before.fields).toMatchObject({ summary: "Checkout redesign", duedate: "2027-03-31", customfield_10015: "2027-01-04", customfield_10030: "Payments", priority: { id: "1" }, project: { key: "PLAT" }, issuetype: { id: "10000" } });
    expect(before.fields.labels).toEqual(["product-velocity", "pv:project/platform", "pv:moscow/must", "pv:rank/top-10", "pv:type/new-feature", "pv:group/payments"]);
    expect(before.notes).toEqual([]);
  });
  it("every Jira slot's default target is what the builder does", () => {
    const f = buildJiraPayload({ item: ITEM, fields: BASE, projectName: "Platform" }).fields;
    const has = (slot: string) => slotsFor("jira").find((s) => s.id === slot)!;
    expect(has("jira.dueDate").defaultFieldId).toBe("duedate");
    expect(f.duedate).toBe("2027-03-31");
    for (const [slot, prefix] of [["jira.label.moscow", "pv:moscow/"], ["jira.label.rank", "pv:rank/"], ["jira.label.type", "pv:type/"], ["jira.label.group", "pv:group/"], ["jira.label.project", "pv:project/"]] as const) {
      expect(has(slot).defaultTarget).toContain(prefix);
      expect((f.labels as string[]).some((l) => l.startsWith(prefix)), slot).toBe(true);
    }
  });
});

describe("Jira overrides", () => {
  it("re-pointing the due date sends it to the chosen field only", () => {
    const m = effectiveJiraMap(BASE, [{ slot: "jira.dueDate", enabled: true, field: "customfield_10016" }]);
    const f = buildJiraPayload({ item: ITEM, fields: m }).fields;
    expect(f.customfield_10016).toBe("2027-03-31");
    expect("duedate" in f).toBe(false);
  });
  it("switching a slot off removes exactly its output and the preview says so", () => {
    const full = buildJiraPayload({ item: ITEM, fields: BASE, projectName: "Platform" });
    for (const [slot, gone] of [["jira.label.moscow", "pv:moscow/must"], ["jira.label.rank", "pv:rank/top-10"], ["jira.label.type", "pv:type/new-feature"], ["jira.label.group", "pv:group/payments"], ["jira.label.project", "pv:project/platform"]] as const) {
      const p = buildJiraPayload({ item: ITEM, fields: effectiveJiraMap(BASE, [{ slot, enabled: false, field: null }]), projectName: "Platform" });
      expect(p.fields.labels).toEqual((full.fields.labels as string[]).filter((l) => l !== gone));
      expect({ ...p.fields, labels: 0 }).toEqual({ ...full.fields, labels: 0 });
      if (slot !== "jira.label.project") expect(p.notes.join(" ")).toContain("switched off");
    }
    const off = buildJiraPayload({ item: ITEM, fields: effectiveJiraMap(BASE, [{ slot: "jira.dueDate", enabled: false, field: null }]) });
    expect("duedate" in off.fields).toBe(false);
    expect(off.notes).toContain("Due date not sent: switched off in the field configuration.");
  });
  it("an unmapped start date or theme still says so (unchanged)", () => {
    const p = buildJiraPayload({ item: ITEM, fields: {} });
    expect(p.notes.join(" ")).toMatch(/Start date not sent.*not mapped/);
    expect(p.notes.join(" ")).toMatch(/Theme not sent/);
  });
});

describe("defaults reproduce today's GitHub behaviour bit for bit", () => {
  const base = { item: ITEM, itemId: "22222222-2222-4222-8222-222222222222", projectName: "Mobile", appUrl: "https://productvelocity.app", artifacts: [{ label: "PRD", url: "https://example.test/prd" }], files: [{ label: "Shot", url: "https://example.test/f" }] };
  it("no options, empty options and the options of an empty configuration build the same issue", () => {
    const a = buildTrackingIssue(base);
    expect(buildTrackingIssue({ ...base, off: [] })).toEqual(a);
    expect(buildTrackingIssue({ ...base, ...githubOptions([]) })).toEqual(a);
    expect(a.labels).toEqual(["product-velocity", "pv:project/mobile", "pv:moscow/must", "pv:rank/top-10", "pv:type/new-feature", "pv:group/payments"]);
    expect(a.milestone).toMatchObject({ title: "2027 Q1" });
    expect(a.typeCandidates).toEqual(["Feature"]);
    expect(a.block).toContain("## Links");
    expect(a.block).toContain("## Files");
  });
  it("switching a slot off removes exactly its output", () => {
    const a = buildTrackingIssue(base);
    const off = (slot: string) => buildTrackingIssue({ ...base, off: [slot] });
    for (const [slot, gone] of [["github.label.moscow", "pv:moscow/must"], ["github.label.rank", "pv:rank/top-10"], ["github.label.type", "pv:type/new-feature"], ["github.label.group", "pv:group/payments"], ["github.label.project", "pv:project/mobile"]] as const) {
      expect(off(slot).labels).toEqual(a.labels.filter((l) => l !== gone));
      expect(off(slot).block).toBe(a.block);
      expect(off(slot).title).toBe(a.title);
    }
    expect(off("github.milestone").milestone).toBeNull();
    expect(off("github.milestone").labels).toEqual(a.labels);
    expect(off("github.issueType").typeCandidates).toEqual([]);
    expect(off("github.issueType").labels).toEqual(a.labels);
    expect(off("github.body.artifacts").block).not.toContain("## Links");
    expect(off("github.body.artifacts").block).toContain("## Files");
    expect(off("github.body.files").block).not.toContain("## Files");
    expect(off("github.body.files").block).toContain("## Links");
    expect(off("github.label.moscow").hash).not.toBe(a.hash); // a change makes the next Sync offer the new text
  });
  it("the sections the two-way compare reads are never switched off", () => {
    const a = buildTrackingIssue(base);
    const b = buildTrackingIssue({ ...base, off: ["github.title", "github.body.summary", "github.body.description", "github.body.hypothesis", "value_12m"] });
    expect(b).toEqual(a);
  });
});

describe("validation", () => {
  const ok = (rows: ConfigRow[], cat: readonly CatalogEntry[] | null = CATALOG) => validateConfig("jira", rows, cat);
  it("accepts a switch-off and a compatible re-point, and drops what is at its default", () => {
    const r = ok([{ slot: "jira.label.moscow", enabled: false, field: null }, { slot: "jira.label.rank", enabled: true, field: null }, { slot: "jira.dueDate", enabled: true, field: "customfield_10016" }]);
    expect(r).toEqual({ ok: true, rows: [{ slot: "jira.label.moscow", enabled: false, field: null }, { slot: "jira.dueDate", enabled: true, field: "customfield_10016" }] });
    expect(ok([{ slot: "jira.dueDate", enabled: true, field: "duedate" }])).toEqual({ ok: true, rows: [] });
  });
  it("refuses a field that does not exist in the catalog read at save time", () => {
    const r = ok([{ slot: "jira.dueDate", enabled: true, field: "customfield_77777" }]);
    expect(r).toMatchObject({ ok: false });
    expect(JSON.stringify(r)).toContain("does not exist in the tracker any more");
  });
  it("refuses a field of the wrong type", () => {
    const r = ok([{ slot: "jira.dueDate", enabled: true, field: "customfield_10040" }]);
    expect(JSON.stringify(r)).toMatch(/needs a date field/);
  });
  it("refuses two Product Velocity fields on one tracker field", () => {
    const r = validateConfig("jira", [{ slot: "jira.dueDate", enabled: true, field: "customfield_10015" }], CATALOG, [{ id: "customfield_10015", label: "Planned Start" }]);
    expect(JSON.stringify(r)).toMatch(/already used for Planned Start/);
  });
  it("refuses to re-point when the fields could not be read, but still lets things be switched off", () => {
    expect(ok([{ slot: "jira.dueDate", enabled: true, field: "customfield_10016" }], null)).toMatchObject({ ok: false });
    expect(ok([{ slot: "jira.label.type", enabled: false, field: null }], null)).toMatchObject({ ok: true });
  });
  it("refuses fixed slots, unknown slots, another tracker's slots and a field on a toggle", () => {
    for (const row of [{ slot: "jira.summary", enabled: false, field: null }, { slot: "jira.description", enabled: false, field: null }, { slot: "value_12m", enabled: true, field: "customfield_10016" }, { slot: "github.label.moscow", enabled: false, field: null }, { slot: "jira.label.moscow", enabled: true, field: "customfield_10016" }]) {
      expect(ok([row]), JSON.stringify(row)).toMatchObject({ ok: false });
    }
    expect(validateConfig("github", [{ slot: "github.body.summary", enabled: false, field: null }], null)).toMatchObject({ ok: false });
  });
  it("no slot can name a commercial field, so nothing commercial can be saved at all", () => {
    for (const s of SLOTS) expect(["value_12m", "confidence", "customers_requesting", "decision", "kr_metric", "outcome_verdict"].includes(s.pvKey)).toBe(false);
  });
});

describe("reading what is stored", () => {
  it("drops unknown, fixed, duplicate and malformed rows (stored data is never trusted)", () => {
    const raw = [{ slot: "jira.label.moscow", enabled: false }, { slot: "jira.label.moscow", enabled: false }, { slot: "jira.summary", enabled: false }, { slot: "x", enabled: false }, { slot: "jira.dueDate", enabled: true, field: "customfield_1; drop" }, { slot: "jira.dueDate", enabled: true, field: "customfield_10016" }, 5, null];
    expect(parseConfigRows(raw, "jira")).toEqual([{ slot: "jira.label.moscow", enabled: false, field: null }, { slot: "jira.dueDate", enabled: true, field: "customfield_10016" }]);
    expect(parseConfigRows("nope", "jira")).toEqual([]);
    expect(parseConfigRows([{ slot: "jira.label.moscow", enabled: false }], "github")).toEqual([]);
  });
});

describe("the optional labels (issue #321): off by default, on when a project switches them on", () => {
  const ITEM2 = { ...ITEM, focus_area: "Demand/Optimisation", value_type: "Defend revenue", tags: ["Q4 push", "payments", "Q4 push"] };
  const ON_ALL = (t: "jira" | "github") => ["tags", "focus"].map((k) => ({ slot: `${t}.label.${k}`, enabled: true, field: null }));
  it("with nothing saved, no label for them is sent on either tracker (today's payloads are unchanged)", () => {
    const j = buildJiraPayload({ item: ITEM2, fields: effectiveJiraMap(BASE, []), projectName: "Platform" });
    expect(j.fields.labels).toEqual(["product-velocity", "pv:project/platform", "pv:moscow/must", "pv:rank/top-10", "pv:type/new-feature", "pv:group/payments", "pv:value/defend-revenue"]); // Business Value Type is on by default
    const g = buildTrackingIssue({ item: ITEM2, itemId: "22222222-2222-4222-8222-222222222222", projectName: "Mobile", appUrl: "https://productvelocity.app", artifacts: [], ...githubOptions([]) });
    expect(g.labels.some((l) => /pv:(tag|focus)\//.test(l))).toBe(false);
  });
  it("switched on, they become pv: labels: one per tag (sorted, no duplicates), the focus area and the business value type", () => {
    const j = buildJiraPayload({ item: ITEM2, fields: effectiveJiraMap(BASE, ON_ALL("jira")), projectName: "Platform" });
    expect((j.fields.labels as string[]).slice(6)).toEqual(["pv:focus/demand-optimisation", "pv:value/defend-revenue", "pv:tag/payments", "pv:tag/q4-push"]);
    const g = buildTrackingIssue({ item: ITEM2, itemId: "22222222-2222-4222-8222-222222222222", projectName: "Mobile", appUrl: "https://productvelocity.app", artifacts: [], ...githubOptions(ON_ALL("github")) });
    expect(g.labels.slice(6)).toEqual(["pv:focus/demand-optimisation", "pv:value/defend-revenue", "pv:tag/payments", "pv:tag/q4-push"]);
  });
  it("each switch only adds its own label, and an empty value adds nothing", () => {
    const only = (k: string) => (buildJiraPayload({ item: ITEM2, fields: effectiveJiraMap(BASE, [{ slot: `jira.label.${k}`, enabled: true, field: null }]), projectName: "Platform" }).fields.labels as string[]).slice(6);
    expect(only("focus")).toEqual(["pv:focus/demand-optimisation", "pv:value/defend-revenue"]); // the value type is on by default
    expect(only("tags")).toEqual(["pv:value/defend-revenue", "pv:tag/payments", "pv:tag/q4-push"]);
    const empty = buildJiraPayload({ item: { ...ITEM, focus_area: "", tags: [] }, fields: effectiveJiraMap(BASE, ON_ALL("jira")), projectName: "Platform" });
    expect((empty.fields.labels as string[]).length).toBe(6);
  });
  it("the Planned Quarter label is on by default and a switch removes it; Business Value Type sends the type, never the amount", () => {
    const item = { ...ITEM2, g2m_quarter: "Q3 2027", value_12m: 999999, value_basis: "Measured" };
    const j = buildJiraPayload({ item, fields: effectiveJiraMap(BASE, []), projectName: "Platform" });
    expect(j.fields.labels as string[]).toContain("pv:quarter/q3-2027");
    expect(buildJiraPayload({ item, fields: effectiveJiraMap(BASE, [{ slot: "jira.label.quarter", enabled: false, field: null }]), projectName: "Platform" }).fields.labels as string[]).not.toContain("pv:quarter/q3-2027");
    const g = buildTrackingIssue({ item, itemId: "22222222-2222-4222-8222-222222222222", projectName: "Mobile", appUrl: "https://productvelocity.app", artifacts: [], ...githubOptions(ON_ALL("github")) });
    expect(g.labels).toContain("pv:quarter/q3-2027");
    expect(g.labels).toContain("pv:value/defend-revenue");
    expect(JSON.stringify([g, j])).not.toMatch(/999999|Measured/);
  });
  it("Focus Area goes into the chosen Jira text field (Theme); the Initiative Group is only a label and is never written into a field", () => {
    const item = { ...ITEM2, theme: "Payments" };
    const sent = buildJiraPayload({ item, fields: { ...effectiveJiraMap(BASE, []), theme: "customfield_10001" }, projectName: "Platform" });
    expect(sent.fields.customfield_10001).toBe("Demand/Optimisation");
    expect(sent.fields.labels as string[]).toContain("pv:group/payments");
    expect(JSON.stringify(sent.fields)).not.toMatch(/"Payments"/);
    const none = buildJiraPayload({ item, fields: {}, projectName: "Platform" });
    expect(Object.keys(none.fields).some((k) => k.startsWith("customfield_"))).toBe(false);
    expect(none.notes.join(" ")).toMatch(/Theme not sent/);
  });
  it("tags are capped at 10 labels and a tag that is only symbols is dropped", () => {
    const many = Array.from({ length: 15 }, (_, n) => `tag ${String(n).padStart(2, "0")}`);
    const j = buildJiraPayload({ item: { ...ITEM, tags: [...many, "!!!"] }, fields: effectiveJiraMap(BASE, [{ slot: "jira.label.tags", enabled: true, field: null }]) });
    expect((j.fields.labels as string[]).filter((l) => l.startsWith("pv:tag/"))).toHaveLength(10);
  });
  it("they are on the config list as default-off switches: the form, the parse and the validation keep only what differs from off", () => {
    expect(parseConfigRows([{ slot: "jira.label.tags", enabled: false }, { slot: "jira.label.focus", enabled: true }, { slot: "jira.label.rank", enabled: false }], "jira")).toEqual([{ slot: "jira.label.focus", enabled: true, field: null }, { slot: "jira.label.rank", enabled: false, field: null }]);
    expect(validateConfig("jira", [{ slot: "jira.label.tags", enabled: false, field: null }, { slot: "jira.label.focus", enabled: true, field: null }, { slot: "jira.label.value", enabled: true, field: null }], null)).toEqual({ ok: true, rows: [{ slot: "jira.label.focus", enabled: true, field: null }] });
    expect(effectiveJiraMap(BASE, [{ slot: "jira.label.tags", enabled: true, field: null }, { slot: "jira.label.moscow", enabled: false, field: null }])).toMatchObject({ on: ["jira.label.tags"], off: ["jira.label.moscow"] });
    expect(githubOptions([{ slot: "github.label.focus", enabled: true, field: null }])).toEqual({ on: ["github.label.focus"] });
  });
});
