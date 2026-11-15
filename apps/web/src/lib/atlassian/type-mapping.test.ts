import { describe, expect, it } from "vitest";
import { initiativeLevelHint, levelLabel, proposeTypeMapping, sortTypesByLevel, typeOptionLabel, validateTypeMapping, type ProjectIssueType } from "./type-mapping";

const t = (id: string, name: string, hierarchyLevel: number, subtask = false): ProjectIssueType => ({ id, name, hierarchyLevel, subtask });
const standard = [t("1", "Epic", 1), t("2", "Story", 0), t("3", "Bug", 0), t("4", "Sub-task", -1, true)];

describe("type mapping proposal", () => {
  it("standard site: Epic is the initiative, Story the PV epic, Sub-task the PV task", () => {
    expect(proposeTypeMapping(standard)).toEqual({ source: "standard", initiative: "1", epic: "2", task: "4" });
  });
  it("a level above Epic: that level is the initiative, Epic the PV epic, Story the PV task", () => {
    const premium = [...standard, t("5", "Initiative", 2), t("6", "Theme", 3)];
    expect(proposeTypeMapping(premium)).toEqual({ source: "above-epic", initiative: "5", epic: "1", task: "2" });
  });
  it("a project without Story (the spike's site) uses its first base type, and Subtask is found by name", () => {
    expect(proposeTypeMapping([t("1", "Epic", 1), t("2", "Feature", 0), t("3", "Task", 0), t("4", "Subtask", -1, true)])).toEqual({ source: "standard", initiative: "1", epic: "2", task: "4" });
  });
  it("proposes what it can when types are missing", () => {
    expect(proposeTypeMapping([t("2", "Task", 0)])).toEqual({ source: "standard", initiative: null, epic: "2", task: null });
    expect(proposeTypeMapping([])).toEqual({ source: "standard", initiative: null, epic: null, task: null });
  });
});

describe("type mapping check", () => {
  it("accepts the proposal", () => {
    expect(validateTypeMapping(standard, { initiative: "1", epic: "2", task: "4" })).toBeNull();
    expect(validateTypeMapping(standard, { initiative: "1", epic: null, task: null })).toBeNull();
  });
  it("needs an initiative, types of this project and three different types", () => {
    expect(validateTypeMapping(standard, { initiative: "", epic: null, task: null })).toMatch(/initiative/);
    expect(validateTypeMapping(standard, { initiative: "99", epic: null, task: null })).toMatch(/does not belong/);
    expect(validateTypeMapping(standard, { initiative: "1", epic: "1", task: null })).toMatch(/different/);
  });
});

describe("telling issue types apart in the mapping (issue #431)", () => {
  // the Refinery89 site has two types named "Initiative": one at level 2 (above Epic), one at level 0
  const site = [t("20", "Initiative", 2), t("1", "Epic", 1), t("2", "Story", 0), t("21", "Initiative", 0), t("4", "Sub-task", -1, true)];
  it("labels every type with its level, so two types with one name differ", () => {
    expect(site.map(typeOptionLabel)).toEqual(["Initiative · level 2, above Epic", "Epic · level 1", "Story · level 0", "Initiative · level 0", "Sub-task · sub-task"]);
    expect(levelLabel(3)).toBe("level 3, above Epic");
    expect(levelLabel(-1)).toBe("sub-task");
    expect(levelLabel(0, true)).toBe("sub-task");
  });
  it("lists the highest level first, then by name", () => {
    expect(sortTypesByLevel(site).map((x) => x.id)).toEqual(["20", "1", "21", "2", "4"]);
    expect(site.map((x) => x.id)).toEqual(["20", "1", "2", "21", "4"]); // the input is not changed
  });
  it("proposes the level above Epic as the initiative, not the level-0 type of the same name", () => {
    expect(proposeTypeMapping(site)).toMatchObject({ source: "above-epic", initiative: "20", epic: "1" });
  });
  it("says what the chosen initiative type means", () => {
    expect(initiativeLevelHint(site, "20")).toContain("above Epic");
    expect(initiativeLevelHint(site, "20")).toContain("any other Jira project");
    expect(initiativeLevelHint(site, "1")).toContain("Epic level");
    expect(initiativeLevelHint(site, "21")).toContain("below Epic level");
    expect(initiativeLevelHint(site, null)).toBeNull();
    expect(initiativeLevelHint(site, "nope")).toBeNull();
  });
});
