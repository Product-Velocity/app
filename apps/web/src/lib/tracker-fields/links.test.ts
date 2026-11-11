import { describe, expect, it } from "vitest";
import { buildMappingView } from "./view";
import { rowDirection, tableRows, trackerFieldLinks } from "./links";
import { EMPTY_QUERY, applyQuery, nextSort } from "./table-query";
import { NEVER_SYNCED, SLOTS } from "./slots";
import type { CatalogEntry } from "./catalog";
import { FIELD_BY_KEY } from "@pv/domain";

const jira = (rows: Parameters<typeof buildMappingView>[0]["rows"] = [], jiraMap: Parameters<typeof buildMappingView>[0]["jiraMap"] = {}) => buildMappingView({ tracker: "jira", rows, jiraMap, choices: null });
const entry = (id: string, name: string, over: Partial<CatalogEntry> = {}): CatalogEntry => ({ id, name, custom: id.startsWith("customfield"), kind: "text", typeLabel: "Text", options: [], filled: null, sampled: null, ...over });
const pvName = (k: string) => FIELD_BY_KEY[k]?.name ?? k;
const labels = (m: Map<string, { label: string }[]>, id: string) => (m.get(id) ?? []).map((l) => l.label);

describe("which Product Velocity field a tracker field is linked to", () => {
  it("Jira defaults: summary, description, labels, due date and status are linked; nothing else is", () => {
    const m = trackerFieldLinks("jira", [{ name: "P", view: jira() }]);
    expect(labels(m, "summary")).toEqual([pvName("initiative_name")]);
    expect(labels(m, "description").length).toBeGreaterThanOrEqual(3);
    expect(m.get("labels")!.length).toBeGreaterThan(5);
    expect(labels(m, "duedate")).toEqual([pvName("g2m_date_est")]);
    expect(m.get("status")![0]).toMatchObject({ pvKey: "status", direction: "from_tracker" });
    expect(m.has("customfield_10016")).toBe(false); // story points: no slot, ignored
    expect(m.has("assignee")).toBe(false);
  });
  it("follows the person's settings: re-pointed due date, chosen start date, switched-off labels", () => {
    const view = jira([{ slot: "jira.dueDate", enabled: true, field: "customfield_10023" }, ...SLOTS.filter((s) => s.tracker === "jira" && s.id.startsWith("jira.label.")).map((s) => ({ slot: s.id, enabled: false, field: null }))], { startDate: "customfield_10015" });
    const m = trackerFieldLinks("jira", [{ name: "P", view }]);
    expect(m.has("duedate")).toBe(false);
    expect(labels(m, "customfield_10023")).toEqual([pvName("g2m_date_est")]);
    expect(labels(m, "customfield_10015")).toEqual([pvName("planned_start")]);
    expect(m.get("labels")!.every((l) => l.state === "off")).toBe(true);
    expect(rowDirection(m.get("labels")!)).toBe("none"); // all switched off: not synced
  });
  it("a priority link exists but is 'not set up' until a Jira priority is chosen", () => {
    const none = trackerFieldLinks("jira", [{ name: "P", view: jira() }]).get("priority")!;
    expect(none[0]?.state).toBe("unset");
    expect(rowDirection(none)).toBe("none");
    const set = trackerFieldLinks("jira", [{ name: "P", view: jira([], { priorityByMoscow: { Must: "1" } }) }]).get("priority")!;
    expect(set[0]?.state).toBe("on");
    expect(rowDirection(set)).toBe("to_tracker");
  });
  it("two projects on one connection: a link on in one and off in the other is 'partly'", () => {
    const off = jira([{ slot: "jira.label.moscow", enabled: false, field: null }]);
    const m = trackerFieldLinks("jira", [{ name: "A", view: jira() }, { name: "B", view: off }]);
    const moscow = m.get("labels")!.find((l) => l.pvKey === "moscow")!;
    expect(moscow).toMatchObject({ state: "partly", detail: "on in A" });
  });
  it("GitHub: board fields link by the board field id, and a missing board links nothing", () => {
    const board = { id: "B", number: 1, title: "Roadmap", url: "u", mapping: { priority: { id: "F9", name: "Priority" }, group: null, dueDate: { id: "F2", name: "Due" }, size: null, status: { id: "F1", name: "Status" }, priorityMap: {} } };
    const view = buildMappingView({ tracker: "github", rows: [], board, choices: null });
    const m = trackerFieldLinks("github", [{ name: "P", view, board }]);
    expect(labels(m, "F9")).toEqual([pvName("moscow")]);
    expect(labels(m, "F2")).toEqual([pvName("g2m_date_est")]);
    expect(m.get("F1")![0]).toMatchObject({ pvKey: "gh_project_status", direction: "from_tracker" });
    expect(m.has("F3")).toBe(false);
    expect(labels(m, "milestone")).toEqual([pvName("g2m_date_est")]);
    const none = trackerFieldLinks("github", [{ name: "P", view: buildMappingView({ tracker: "github", rows: [], board: null, choices: null }), board: null }]);
    expect(none.has("F9")).toBe(false);
  });
  it("a commercial field (rule 2) is never linked to any tracker field, whatever the settings", () => {
    for (const tracker of ["jira", "github"] as const) {
      const all = SLOTS.filter((s) => s.tracker === tracker).map((s) => ({ slot: s.id, enabled: true, field: null }));
      const view = buildMappingView({ tracker, rows: all, jiraMap: {}, choices: null });
      const keys = [...trackerFieldLinks(tracker, [{ name: "P", view }]).values()].flat().map((l) => l.pvKey);
      expect(keys.filter((k) => NEVER_SYNCED.has(k))).toEqual([]);
    }
  });
});

describe("the tracker field table", () => {
  const entries = [
    entry("summary", "Summary"), entry("duedate", "Due date", { kind: "date", typeLabel: "Date" }), entry("customfield_10016", "Story point estimate", { typeLabel: "Number", filled: 33, sampled: 50 }),
    entry("priority", "Priority", { typeLabel: "Select", options: ["Highest", "Low"], filled: 50, sampled: 50 }), entry("customfield_10028", "Story Points", { typeLabel: "Number", filled: 0, sampled: 50 }), entry("comment", "Comment", { typeLabel: "Other" }),
  ];
  const rows = tableRows(entries, trackerFieldLinks("jira", [{ name: "P", view: jira() }]));
  const ids = (q: Partial<typeof EMPTY_QUERY>) => applyQuery(rows, { ...EMPTY_QUERY, ...q }).map((r) => r.id);
  it("searches name, id, options and the linked Product Velocity field", () => {
    expect(ids({ text: "story" })).toEqual(["customfield_10016", "customfield_10028"]);
    expect(ids({ text: "10016" })).toEqual(["customfield_10016"]);
    expect(ids({ text: "highest" })).toEqual(["priority"]);
    expect(ids({ text: pvName("g2m_date_est").toLowerCase() })).toContain("duedate");
  });
  it("filters by type, kind and sync direction", () => {
    expect(ids({ type: "Number" })).toEqual(["customfield_10016", "customfield_10028"]);
    expect(ids({ kind: "custom" })).toEqual(["customfield_10016", "customfield_10028"]);
    expect(ids({ direction: "used" })).toEqual(["summary", "duedate"]);
    expect(ids({ direction: "none" })).toEqual(["customfield_10016", "priority", "customfield_10028", "comment"]);
    expect(ids({ direction: "two_way" })).toEqual(["summary"]);
  });
  it("sorts, keeps the tracker's order on ties, and puts empty values last in both directions", () => {
    expect(ids({ sort: "name" })).toEqual(["comment", "duedate", "priority", "customfield_10016", "customfield_10028", "summary"]);
    expect(ids({ sort: "filled" }).slice(0, 3)).toEqual(["customfield_10028", "customfield_10016", "priority"]);
    expect(ids({ sort: "filled", desc: true }).slice(0, 3)).toEqual(["priority", "customfield_10016", "customfield_10028"]);
    expect(ids({ sort: "filled", desc: true }).slice(3)).toEqual(["summary", "duedate", "comment"]);
    expect(ids({ sort: "direction" })[0]).toBe("summary");
  });
  it("a header click goes ascending, descending, then back to the tracker's order", () => {
    const a = nextSort(EMPTY_QUERY, "name"), d = nextSort(a, "name"), off = nextSort(d, "name");
    expect([a.sort, a.desc, d.desc, off.sort]).toEqual(["name", false, true, null]);
    expect(nextSort(d, "id")).toMatchObject({ sort: "id", desc: false });
  });
});
