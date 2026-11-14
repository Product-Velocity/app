import { describe, expect, it } from "vitest";
import type { GroupRow } from "@pv/domain";
import { isIssueRow, withIssueRows } from "./issue-rows";
import type { GridItem, IssueTreeRow, JiraTreeRow } from "./types";

const item = (id: string) => ({ id }) as GridItem;
const jira = (key: string, o: Partial<JiraTreeRow> = {}): JiraTreeRow => ({ key, parentKey: "P-1", level: 1, position: 0, title: `T ${key}`, type: "Epic", status: "To Do", category: "new", assignee: null, url: null, updatedAt: null, ...o });
const gh = (n: number): IssueTreeRow => ({ repo: "acme/app", number: n, parentNumber: null, level: 1, title: `Epic ${n}`, state: "open", stateReason: null, assignees: ["ana"], createdBy: "app", updatedAt: "2026-11-12T10:00:00Z" });
const header = { __group: true, id: "group:x:1", key: "x:1", label: "1", count: 1, collapsed: false, level: 0, healthSummary: "" } as GroupRow;

describe("issue rows under initiatives (issue #437)", () => {
  it("puts each initiative's issues directly under it, group headers pass through, no children means no rows", () => {
    const out = withIssueRows([header, item("a"), item("b"), item("c")], { jira: { a: [jira("P-2"), jira("P-3")] }, github: { c: [gh(7)] } });
    expect(out.map((r) => ("__group" in r ? "#" : isIssueRow(r) ? `  ${r.child.key}` : r.id))).toEqual(["#", "a", "  P-2", "  P-3", "b", "c", "  acme/app#7"]);
  });
  it("gives each issue row a stable id and its parent", () => {
    const out = withIssueRows([item("a")], { jira: { a: [jira("P-2")] }, github: {} });
    expect(out[1]).toMatchObject({ __issue: true, id: "issue:a:P-2", parentId: "a" });
  });
  it("uses Jira when an initiative has both, as the Excel report does", () => {
    const out = withIssueRows([item("a")], { jira: { a: [jira("P-2")] }, github: { a: [gh(1)] } });
    expect(out.filter(isIssueRow).map((r) => r.child.key)).toEqual(["P-2"]);
  });
  it("is the rows unchanged when nothing is loaded", () => {
    const rows = [header, item("a")];
    expect(withIssueRows(rows, { jira: {}, github: {} })).toEqual(rows);
  });
});
