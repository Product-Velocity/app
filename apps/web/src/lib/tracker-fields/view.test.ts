import { describe, expect, it } from "vitest";
import { buildMappingView } from "./view";
import { mappingRows } from "./slots";
import { FIELDS } from "@pv/domain";

const choices = { startDates: [{ id: "customfield_10015", name: "Start date" }], themes: [{ id: "customfield_10030", name: "Theme" }], priorities: [{ id: "1", name: "Highest" }], dateFields: [{ id: "duedate", name: "Due date", custom: false, kind: "date" as const, typeLabel: "Date", options: [], filled: null, sampled: null }, { id: "customfield_10016", name: "Go-live", custom: true, kind: "date" as const, typeLabel: "Date", options: [], filled: null, sampled: null }], proposal: {} };

describe("the mapping table of a project", () => {
  it("Jira: every field of the dictionary is on the page once or more, nothing is lost between the two lists", () => {
    const v = buildMappingView({ tracker: "jira", rows: [], jiraMap: {}, choices });
    const keys = new Set([...v.changeable.map((r) => r.key), ...v.fixed.map((r) => r.key)]);
    expect([...keys].sort()).toEqual(FIELDS.map((f) => f.key).sort());
    expect(v.changeable.length + v.fixed.length).toBe(mappingRows("jira").length);
    expect(Object.values(v.counts).reduce((a, b) => a + b, 0)).toBe(mappingRows("jira").length);
    expect(v.changeable.every((r) => r.isDefault)).toBe(true);
  });
  it("shows the person's own settings and says which differ from the default", () => {
    const v = buildMappingView({ tracker: "jira", rows: [{ slot: "jira.label.moscow", enabled: false, field: null }, { slot: "jira.dueDate", enabled: true, field: "customfield_10016" }], jiraMap: { startDate: "customfield_10015", priorityByMoscow: { Must: "1" } }, choices });
    const by = (id: string) => v.changeable.find((r) => r.id === id)!;
    expect(by("jira.label.moscow")).toMatchObject({ control: { type: "toggle", on: false }, isDefault: false });
    expect(by("jira.label.rank")).toMatchObject({ control: { type: "toggle", on: true }, isDefault: true });
    expect(by("jira.dueDate")).toMatchObject({ control: { type: "select", value: "customfield_10016" }, isDefault: false });
    expect(by("jira.startDate")).toMatchObject({ control: { type: "select", value: "customfield_10015" }, isDefault: false });
    expect(by("jira.priority").isDefault).toBe(false);
    expect(by("jira.theme").isDefault).toBe(true);
  });
  it("a saved field that the site no longer lists stays visible, marked as missing", () => {
    const v = buildMappingView({ tracker: "jira", rows: [], jiraMap: { startDate: "customfield_10099" }, choices });
    const sel = v.changeable.find((r) => r.id === "jira.startDate")!.control;
    expect(sel.type === "select" && sel.options.some((o) => o.value === "customfield_10099" && /not found/.test(o.label))).toBe(true);
  });
  it("a site that could not be read is flagged and offers no fields", () => {
    const v = buildMappingView({ tracker: "jira", rows: [], jiraMap: {}, choices: null });
    expect(v.unreadable).toBe(true);
    const sel = v.changeable.find((r) => r.id === "jira.startDate")!.control;
    expect(sel.type === "select" && sel.options).toEqual([]);
  });
  it("Never synced and tracker-driven rows are in the fixed list and carry a reason", () => {
    const v = buildMappingView({ tracker: "github", rows: [], choices: null });
    const value = v.fixed.find((r) => r.key === "value_12m")!;
    expect(value).toMatchObject({ direction: "never", target: "Never synced" });
    expect(value.reason).toMatch(/Commercial/);
    expect(v.fixed.find((r) => r.key === "open_prs")).toMatchObject({ direction: "from_tracker" });
    expect(v.changeable.some((r) => r.key === "value_12m" || r.key === "open_prs")).toBe(false);
  });
  it("GitHub board rows show the board mapping, and say so when no board is linked", () => {
    const board = { id: "B", number: 1, title: "Roadmap", url: "https://x", mapping: { priority: { id: "f1", name: "Priority" }, group: null, dueDate: null, size: null, status: null, priorityMap: {} } };
    const v = buildMappingView({ tracker: "github", rows: [], choices: null, board });
    expect(v.changeable.find((r) => r.id === "github.board.priority")!.control).toMatchObject({ type: "board", current: "Priority" });
    expect(v.changeable.find((r) => r.id === "github.board.group")!.control).toMatchObject({ type: "board", current: null, note: expect.stringContaining("No board field is chosen") });
    const none = buildMappingView({ tracker: "github", rows: [], choices: null, board: null });
    expect(none.changeable.find((r) => r.id === "github.board.size")!.control).toMatchObject({ note: "No board is linked to this project." });
  });
  it("an optional label shows as off and default until it is switched on", () => {
    const off = buildMappingView({ tracker: "jira", rows: [], jiraMap: {}, choices });
    expect(off.changeable.find((r) => r.id === "jira.label.tags")).toMatchObject({ control: { type: "toggle", on: false }, isDefault: true });
    const on = buildMappingView({ tracker: "github", rows: [{ slot: "github.label.focus", enabled: true, field: null }] });
    expect(on.changeable.find((r) => r.id === "github.label.focus")).toMatchObject({ control: { type: "toggle", on: true }, isDefault: false });
    expect(on.changeable.find((r) => r.id === "github.label.moscow")).toMatchObject({ control: { on: true }, isDefault: true });
  });
});
