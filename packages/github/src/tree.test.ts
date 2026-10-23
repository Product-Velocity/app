import { describe, expect, it } from "vitest";
import { MemorySourceControl } from "./memory-source";
import { readIssueTree, summariseTree, type TreeNode } from "./tree";

const sub = (number: number, state: "open" | "closed" = "open", stateReason: string | null = null) => ({ number, id: number, repo: "o/r", title: `t${number}`, state, stateReason, closedAt: null, assignees: [], createdBy: "engineer" as const });
const node = (number: number, level: 1 | 2, parentNumber: number | null, state: "open" | "closed" = "open", reason: string | null = null): TreeNode => ({ ...sub(number, state, reason), level, parentNumber });

describe("issue tree", () => {
  it("reads epics and their tasks", async () => {
    const sc = new MemorySourceControl();
    sc.subs.set("o/r#1", [sub(2), sub(3)]);
    sc.subs.set("o/r#2", [sub(4), sub(5)]);
    const tree = await readIssueTree(sc, 1, "o/r", 1);
    expect(tree?.map((n) => [n.number, n.level, n.parentNumber])).toEqual([[2, 1, null], [3, 1, null], [4, 2, 2], [5, 2, 2]]);
  });
  it("is null when sub-issues are unavailable", async () => {
    const sc = new MemorySourceControl();
    sc.subs.set("o/r#1", null);
    expect(await readIssueTree(sc, 1, "o/r", 1)).toBeNull();
  });
  it("counts leaves: tasks, and epics without tasks", () => {
    const s = summariseTree([node(2, 1, null), node(3, 1, null, "closed"), node(4, 2, 2, "closed"), node(5, 2, 2)]);
    expect(s).toMatchObject({ total: 3, closed: 2, progressPct: 67 });
  });
  it("leaves not-planned work out of the total", () => {
    expect(summariseTree([node(2, 1, null, "closed"), node(3, 1, null, "closed", "not_planned")])).toMatchObject({ total: 1, closed: 1, progressPct: 100 });
  });
  it("has no progress while nothing is planned and warns near the limit", () => {
    expect(summariseTree([]).progressPct).toBeNull();
    expect(summariseTree(Array.from({ length: 95 }, (_, i) => node(i + 2, 1, null))).nearLimit).toBe(true);
  });
});

import { parseSubIssueEvent } from "./webhook";
describe("sub_issues delivery", () => {
  it("reads only the parent's repository and number", () => {
    const p = { action: "sub_issue_added", installation: { id: 9 }, repository: { full_name: "Acme/App" }, parent_issue: { number: 34, title: "ignored" }, sub_issue: { title: "ignored" } };
    expect(parseSubIssueEvent("sub_issues", p)).toEqual({ action: "sub_issue_added", installationId: 9, repo: "Acme/App", parentNumber: 34 });
    expect(parseSubIssueEvent("issues", p)).toBeNull();
    expect(parseSubIssueEvent("sub_issues", { ...p, parent_issue: {} })).toBeNull();
  });
});
