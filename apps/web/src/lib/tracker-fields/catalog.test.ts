import { describe, expect, it } from "vitest";
import { githubCatalogGroups, jiraCatalogGroups, sampledOptions } from "./catalog";

describe("Jira catalog", () => {
  const fields = [
    { id: "summary", name: "Summary", custom: false, schema: { type: "string", system: "summary" } },
    { id: "customfield_10015", name: "Start date", custom: true, schema: { type: "date", custom: "com.atlassian.jira.plugin.system.customfieldtypes:datepicker" } },
    { id: "customfield_10030", name: "Theme", custom: true, schema: { type: "string", custom: "com.atlassian.jira.plugin.system.customfieldtypes:textfield" } },
    { id: "customfield_10040", name: "Team", custom: true, schema: { type: "option", custom: "com.atlassian.jira.plugin.system.customfieldtypes:select" } },
  ];
  const issues = [{ fields: { summary: "a", customfield_10015: "2026-01-01", customfield_10040: { value: "Blue" } } }, { fields: { summary: "b", customfield_10040: { value: "Red" } } }];
  it("lists system and custom fields by id with kind, a sampled fill rate and the options seen", () => {
    const g = jiraCatalogGroups({ fields: fields as never, issues, priorities: [{ id: "1", name: "Highest" }], issueTypes: [{ id: "10001", name: "Epic", hierarchyLevel: 1 }] });
    const entries = g[0]!.entries;
    const start = entries.find((e) => e.id === "customfield_10015")!;
    expect(start).toMatchObject({ custom: true, kind: "date", filled: 1, sampled: 2 });
    expect(entries.find((e) => e.id === "customfield_10040")).toMatchObject({ kind: "select", options: ["Blue", "Red"], filled: 2 });
    expect(entries.find((e) => e.id === "summary")).toMatchObject({ custom: false, kind: "text" });
    expect(g.map((x) => x.id)).toEqual(["fields", "priorities", "issuetypes"]);
  });
  it("says so when a part could not be read, and keeps the other parts", () => {
    const g = jiraCatalogGroups({ fields: null, issues: [], priorities: [{ id: "1", name: "High" }], issueTypes: null });
    expect(g[0]!.error).toMatch(/could not be read just now/);
    expect(g[1]!.entries).toHaveLength(1);
    expect(g[2]!.error).toMatch(/could not be read just now/);
  });
  it("shows no fill rate when the sample failed", () => {
    const g = jiraCatalogGroups({ fields: fields as never, issues: [], priorities: [], issueTypes: [], sampleError: "x" });
    expect(g[0]!.entries.every((e) => e.filled === null && e.sampled === null)).toBe(true);
  });
  it("cuts the options seen", () => {
    const many = Array.from({ length: 40 }, (_, n) => ({ fields: { f: { value: `v${String(n).padStart(2, "0")}` } } }));
    expect(sampledOptions("f", many)).toHaveLength(20);
  });
});

describe("GitHub catalog", () => {
  it("shows organisation issue fields, built-in fields, board fields, labels, issue types and milestones", () => {
    const g = githubCatalogGroups({
      issueFields: [{ id: "IF_1", name: "Priority", dataType: "single_select", options: ["Urgent", "High"] }],
      boards: [{ title: "Roadmap", fields: [{ id: "F1", name: "Status", dataType: "SINGLE_SELECT", options: [{ id: "o1", name: "Todo" }] }, { id: "F2", name: "Target date", dataType: "DATE" }, { id: "F3", name: "Title", dataType: "TEXT" }] }],
      labels: [{ repo: "Acme/app", labels: [{ name: "pv:moscow/must", description: null }, { name: "bug", description: null }] }],
      issueTypes: ["Epic", "Bug"],
      milestones: [{ repo: "Acme/app", milestones: [{ title: "2026 Q4", dueOn: null, state: "open" }] }],
    });
    expect(g.find((x) => x.id === "issue-fields")!.entries[0]).toMatchObject({ id: "IF_1", kind: "select", options: ["Urgent", "High"], custom: true });
    const board = g.find((x) => x.id.startsWith("board-"))!;
    expect(board.entries.find((e) => e.name === "Target date")).toMatchObject({ kind: "date", custom: true });
    expect(board.entries.find((e) => e.name === "Title")!.custom).toBe(false);
    expect(g.find((x) => x.id === "labels-Acme/app")!.entries.map((e) => e.typeLabel)).toEqual(["Label (Product Velocity)", "Label"]);
    expect(g.find((x) => x.id === "issue-types")!.entries.map((e) => e.name)).toEqual(["Epic", "Bug"]);
    expect(g.find((x) => x.id === "milestones-Acme/app")!.entries[0]!.name).toBe("2026 Q4");
  });
  it("explains the missing App permission instead of failing", () => {
    const g = githubCatalogGroups({ issueFields: null, boards: [{ title: "Roadmap", fields: null }], labels: [], issueTypes: null, milestones: [] });
    expect(g[0]!.note).toMatch(/Issue fields/);
    expect(g.find((x) => x.id.startsWith("board-"))!.error).toMatch(/could not be read just now/);
    expect(g.find((x) => x.id === "issue-types")!.note).toMatch(/cannot read/);
  });
});
