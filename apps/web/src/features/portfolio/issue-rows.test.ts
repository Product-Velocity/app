import { describe, expect, it } from "vitest";
import type { GroupRow } from "@pv/domain";
import { isIssueRow, issueRowsOf, issueSummary, withIssueRows } from "./issue-rows";
import type { GridItem, IssueTreeRow, JiraTreeRow } from "./types";

const item = (id: string, name = id) => ({ id, item_code: `R-${id}`, initiative_name: name }) as unknown as GridItem;
const jira = (key: string, o: Partial<JiraTreeRow> = {}): JiraTreeRow => ({ key, parentKey: "P-1", level: 1, position: 0, title: `T ${key}`, type: "Epic", status: "To Do", category: "new", assignee: null, url: null, updatedAt: null, ...o });
const gh = (n: number): IssueTreeRow => ({ repo: "acme/app", number: n, parentNumber: null, level: 1, title: `Epic ${n}`, state: "open", stateReason: null, assignees: ["ana"], createdBy: "app", updatedAt: "2026-11-12T10:00:00Z" });

describe("issue rows under initiatives (issue #437)", () => {
  it("makes a row per linked issue with a stable id and its parent; Jira wins when an initiative has both, as in the Excel report", () => {
    const rows = issueRowsOf(item("a"), { jira: { a: [jira("P-2"), jira("P-3")] }, github: { a: [gh(1)] } });
    expect(rows.map((r) => r.child.key)).toEqual(["P-2", "P-3"]);
    expect(rows[0]).toMatchObject({ __issue: true, id: "issue:a:P-2", parentId: "a" });
    expect(issueRowsOf(item("b"), { jira: {}, github: { b: [gh(7)] } })[0]!.child.key).toBe("acme/app#7");
  });
  it("is empty when nothing is loaded for the initiative", () => {
    expect(issueRowsOf(item("a"), { jira: {}, github: {} })).toEqual([]);
  });
  it("sums the issues up by status group in words", () => {
    const rows = issueRowsOf(item("a"), { jira: { a: [jira("P-2"), jira("P-3", { category: "done", status: "Done" }), jira("P-4", { category: "done", status: "Done" }), jira("P-5", { category: null, status: null })] }, github: {} });
    expect(issueSummary(rows)).toBe("1 To Do · 2 Done · 1 Other");
    expect(issueSummary([])).toBe("");
  });
  it("puts an Issues header (level 2) and the issues under each initiative that has some; the initiative row stays; group headers pass through", () => {
    const header = { __group: true, id: "group:x:1", key: "x:1", label: "1", count: 1, collapsed: false, level: 0, healthSummary: "" } as GroupRow;
    const kids = { jira: { a: [jira("P-2"), jira("P-3", { category: "done", status: "Done" })] }, github: { c: [gh(7)] } };
    const out = withIssueRows([header, item("a"), item("b"), item("c")], kids, new Set());
    expect(out.map((r) => ("__group" in r ? `# ${r.label} ${r.count} L${r.level}` : isIssueRow(r) ? `  ${r.child.key}` : r.id))).toEqual(["# 1 1 L0", "a", "# Issues of R-a 2 L2", "  P-2", "  P-3", "b", "c", "# Issues of R-c 1 L2", "  acme/app#7"]);
    expect(out[2]).toMatchObject({ key: "issues:a", unit: "issues", initiativeId: "a", healthSummary: "1 To Do · 1 Done", collapsed: false });
  });
  it("a collapsed Issues header keeps the header and hides its issues; nothing loaded means no header", () => {
    const kids = { jira: { a: [jira("P-2")] }, github: {} };
    const out = withIssueRows([item("a"), item("b")], kids, new Set(["issues:a"]));
    expect(out.map((r) => ("__group" in r ? `# ${r.collapsed ? "collapsed" : "open"}` : r.id))).toEqual(["a", "# collapsed", "b"]);
    const rows = [item("a")];
    expect(withIssueRows(rows, { jira: {}, github: {} }, new Set())).toEqual(rows);
  });
});
