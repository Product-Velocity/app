import { describe, expect, it } from "vitest";
import { lightTree, type LightIssue } from "./light-tree";

const i = (key: string, parent: string | null, cat: string | null = "indeterminate"): LightIssue => ({ issue_key: key, parent_key: parent, title: key, issue_type: "Task", status: "In Progress", status_category: cat, html_url: `https://x.atlassian.net/browse/${key}`, jira_updated_at: null });

describe("lightTree", () => {
  it("lists the children of the root, then their sub-tasks, in key order", () => {
    const rows = lightTree("R-1", [i("R-9", "R-1"), i("R-3", "R-1"), i("R-5", "R-3"), i("R-7", "R-99"), i("R-1", null)]);
    expect(rows.map((r) => `${r.level}:${r.key}`)).toEqual(["1:R-3", "2:R-5", "1:R-9"]);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
    expect(rows.every((r) => r.fromList && r.assignee === null)).toBe(true);
  });
  it("is empty when nothing points at the root, and ignores an unknown category", () => {
    expect(lightTree("R-1", [i("R-2", null)])).toEqual([]);
    expect(lightTree("R-1", [i("R-2", "R-1", "weird")])[0]!.category).toBeNull();
  });
  it("never lists a cycle twice", () => {
    expect(lightTree("R-1", [i("R-2", "R-1"), i("R-3", "R-2"), i("R-2", "R-3")]).map((r) => r.key)).toEqual(["R-2", "R-3"]);
  });
});
