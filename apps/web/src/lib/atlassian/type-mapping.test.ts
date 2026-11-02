import { describe, expect, it } from "vitest";
import { proposeTypeMapping, validateTypeMapping, type ProjectIssueType } from "./type-mapping";

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
