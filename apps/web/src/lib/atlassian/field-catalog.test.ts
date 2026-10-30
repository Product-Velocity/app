import { describe, expect, it } from "vitest";
import { buildFieldCatalog, fieldKind, fieldRole, hierarchyLevels, proposeInitiativeLevel, tallyFill, type JiraField, type JiraIssueType } from "./field-catalog";

const fields: JiraField[] = [
  { id: "summary", name: "Summary", custom: false, schema: { type: "string", system: "summary" } },
  { id: "labels", name: "Labels", custom: false, schema: { type: "array", items: "string", system: "labels" } },
  { id: "customfield_10016", name: "Story point estimate", custom: true, schema: { type: "number", custom: "com.atlassian.jira.plugin.system.customfieldtypes:float" } },
  { id: "customfield_10020", name: "Sprint", custom: true, schema: { type: "array", items: "json", custom: "com.pyxis.greenhopper.jira:gh-sprint" } },
  { id: "customfield_10050", name: "Region", custom: true, schema: { type: "option", custom: "com.atlassian.jira.plugin.system.customfieldtypes:select" } },
  { id: "customfield_10051", name: "Notes", custom: true, schema: { type: "string", custom: "com.atlassian.jira.plugin.system.customfieldtypes:textarea" } },
];

describe("field kinds and roles", () => {
  it("reads the kind from the schema", () => {
    expect(fieldKind(fields[1]!.schema)).toBe("labels");
    expect(fieldKind(fields[2]!.schema)).toBe("number");
    expect(fieldKind(fields[3]!.schema)).toBe("sprint");
    expect(fieldKind(fields[4]!.schema)).toBe("select");
    expect(fieldKind(undefined)).toBe("other");
  });
  it("hints a role from site-specific names and ids, and none for unknown fields", () => {
    expect(fieldRole(fields[2]!)).toBe("story_points");
    expect(fieldRole(fields[3]!)).toBe("sprint");
    expect(fieldRole(fields[1]!)).toBe("labels");
    expect(fieldRole(fields[4]!)).toBeNull();
  });
});

describe("fill rate", () => {
  const issues = [
    { fields: { summary: "A", labels: [], customfield_10016: 3, customfield_10051: "  " } },
    { fields: { summary: "B", labels: ["x"], customfield_10016: null } },
    { fields: { summary: "C" } },
  ];
  it("counts only real values: empty text, empty lists and null do not count", () => {
    const t = tallyFill(issues);
    expect(t.get("summary")).toBe(3);
    expect(t.get("labels")).toBe(1);
    expect(t.get("customfield_10016")).toBe(1);
    expect(t.get("customfield_10051")).toBeUndefined();
  });
  it("builds the catalog with hinted fields first and the sample size on every row", () => {
    const rows = buildFieldCatalog(fields, issues);
    expect(rows.map((r) => r.name).slice(0, 3)).toEqual(["Labels", "Sprint", "Story point estimate"]);
    expect(rows.every((r) => r.sampled === 3)).toBe(true);
    expect(rows.find((r) => r.id === "customfield_10050")).toMatchObject({ filled: 0, custom: true, role: null });
  });
});

describe("hierarchy", () => {
  const standard: JiraIssueType[] = [
    { id: "1", name: "Epic", hierarchyLevel: 1 },
    { id: "2", name: "Story", hierarchyLevel: 0 },
    { id: "3", name: "Bug", hierarchyLevel: 0 },
    { id: "4", name: "Sub-task", hierarchyLevel: -1, subtask: true },
  ];
  it("groups types by level, highest first", () => {
    expect(hierarchyLevels(standard)).toEqual([
      { level: 1, types: ["Epic"] },
      { level: 0, types: ["Bug", "Story"] },
      { level: -1, types: ["Sub-task"] },
    ]);
  });
  it("proposes Epic on a standard site and the level above Epic when there is one", () => {
    expect(proposeInitiativeLevel(hierarchyLevels(standard))).toEqual({ source: "standard", types: ["Epic"] });
    const premium = [...standard, { id: "5", name: "Initiative", hierarchyLevel: 2 }, { id: "6", name: "Theme", hierarchyLevel: 3 }];
    expect(proposeInitiativeLevel(hierarchyLevels(premium))).toEqual({ source: "above-epic", types: ["Initiative"] });
  });
});
