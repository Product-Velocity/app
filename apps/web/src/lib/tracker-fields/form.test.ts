import { describe, expect, it } from "vitest";
import { configRowsFromForm, jiraMapFromForm, OFF_VALUE, ON, FIELD, RESET, validateJiraMap } from "./form";
import { validateConfig } from "./mapping";

const form = (vals: Record<string, string>) => ({ get: (n: string) => vals[n] ?? "", has: (n: string) => n in vals });
const ALL_JIRA_ON = Object.fromEntries(["moscow", "rank", "type", "group", "project"].map((k) => [ON(`jira.label.${k}`), "on"]));
const ALL_GH_ON = Object.fromEntries(["label.moscow", "label.rank", "label.type", "label.group", "label.project", "milestone", "issueType", "body.artifacts", "body.files"].map((k) => [ON(`github.${k}`), "on"]));

describe("the form", () => {
  it("an untouched form is the default configuration (nothing stored)", () => {
    const { get, has } = form(ALL_JIRA_ON);
    expect(configRowsFromForm("jira", get, has)).toEqual([]);
    expect(jiraMapFromForm(get)).toEqual({});
    const g = form(ALL_GH_ON);
    expect(configRowsFromForm("github", g.get, g.has)).toEqual([]);
  });
  it("an unchecked box is a switched-off slot; a chosen field is a re-point; the off option switches a field slot off", () => {
    const vals = { ...ALL_JIRA_ON }; delete (vals as Record<string, string>)[ON("jira.label.rank")];
    const f1 = form({ ...vals, [FIELD("jira.dueDate")]: "customfield_10016" });
    expect(configRowsFromForm("jira", f1.get, f1.has)).toEqual([{ slot: "jira.label.rank", enabled: false, field: null }, { slot: "jira.dueDate", enabled: true, field: "customfield_10016" }]);
    const f2 = form({ ...ALL_JIRA_ON, [FIELD("jira.dueDate")]: OFF_VALUE });
    expect(configRowsFromForm("jira", f2.get, f2.has)).toEqual([{ slot: "jira.dueDate", enabled: false, field: null }]);
  });
  it("reset puts one setting, or all of them, back to the default", () => {
    const vals = { [FIELD("jira.dueDate")]: "customfield_10016", [FIELD("jira.startDate")]: "customfield_10015", [FIELD("jira.theme")]: "customfield_10030", priority_Must: "1" };
    const one = form({ ...vals, [RESET]: "jira.dueDate" });
    expect(configRowsFromForm("jira", one.get, one.has).some((r) => r.slot === "jira.dueDate")).toBe(false);
    expect(jiraMapFromForm(one.get)).toEqual({ startDate: "customfield_10015", theme: "customfield_10030", priorityByMoscow: { Must: "1" } });
    const startOnly = form({ ...vals, [RESET]: "jira.startDate" });
    expect(jiraMapFromForm(startOnly.get)).toEqual({ theme: "customfield_10030", priorityByMoscow: { Must: "1" } });
    const prio = form({ ...vals, [RESET]: "jira.priority" });
    expect(jiraMapFromForm(prio.get)).toEqual({ startDate: "customfield_10015", theme: "customfield_10030" });
    const all = form({ ...vals, [RESET]: "all" });
    expect(configRowsFromForm("jira", all.get, all.has)).toEqual([]);
    expect(jiraMapFromForm(all.get)).toEqual({});
  });
  it("a hand-made form can not carry a commercial field, a fixed slot or a malformed id", () => {
    const f = form({ ...ALL_JIRA_ON, [FIELD("value_12m")]: "customfield_1", [ON("jira.summary")]: "", [FIELD("jira.dueDate")]: "customfield_1; drop", startDate: "x" });
    const rows = configRowsFromForm("jira", f.get, f.has);
    expect(validateConfig("jira", rows, [])).toMatchObject({ ok: false }); // the id is not in the catalog (and the pattern refuses it)
    expect(rows.every((r) => r.slot.startsWith("jira."))).toBe(true);
    expect(rows.map((r) => r.slot)).not.toContain("jira.summary");
    expect(jiraMapFromForm(form({ [FIELD("jira.startDate")]: "duedate", [FIELD("jira.theme")]: "summary" }).get)).toEqual({});
  });
});

describe("validateJiraMap", () => {
  const choices = { startDates: [{ id: "customfield_10015", name: "Start date" }], themes: [{ id: "customfield_10030", name: "Theme" }], priorities: [{ id: "1", name: "Highest" }] };
  it("accepts what the site offers and refuses what it does not", () => {
    expect(validateJiraMap({ startDate: "customfield_10015", theme: "customfield_10030", priorityByMoscow: { Must: "1" } }, {}, choices)).toEqual([]);
    expect(validateJiraMap({ startDate: "customfield_99999" }, {}, choices)).toHaveLength(1);
    expect(validateJiraMap({ theme: "customfield_10015" }, {}, choices)).toHaveLength(1);
    expect(validateJiraMap({ priorityByMoscow: { Must: "42" } }, {}, choices)).toHaveLength(1);
  });
  it("when the site can not be read, only an unchanged map passes", () => {
    const stored = { startDate: "customfield_10015" };
    expect(validateJiraMap(stored, stored, null)).toEqual([]);
    expect(validateJiraMap({ startDate: "customfield_10099" }, stored, null)).toHaveLength(1);
    expect(validateJiraMap({}, stored, null)).toHaveLength(1);
  });
});
