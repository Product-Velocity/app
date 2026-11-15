import { describe, expect, it } from "vitest";
import type { GroupRow } from "@pv/domain";
import { isIssueRow, issueInfoOf, issueRowsOf, issueSummary, issueTypeCounts, withIssueRows } from "./issue-rows";
import type { GridItem, IssueTreeRow, JiraTreeRow } from "./types";

const item = (id: string) => ({ id, item_code: `R-${id}` }) as unknown as GridItem;
const jira = (key: string, o: Partial<JiraTreeRow> = {}): JiraTreeRow => ({ key, parentKey: "P-1", level: 1, position: 0, title: `T ${key}`, type: "Epic", status: "To Do", category: "new", assignee: null, url: null, updatedAt: null, ...o });
const gh = (n: number): IssueTreeRow => ({ repo: "acme/app", number: n, parentNumber: null, level: 1, title: `Epic ${n}`, state: "open", stateReason: null, assignees: ["ana"], createdBy: "app", updatedAt: "2026-11-12T10:00:00Z" });
const header = { __group: true, id: "group:x:1", key: "x:1", label: "1", count: 1, collapsed: false, level: 0, healthSummary: "" } as GroupRow;
const none = new Set<string>();

describe("issue rows under initiatives (issue #437)", () => {
  it("makes a row per linked issue with a stable id, its parent and a last flag; Jira wins when an initiative has both, as in the Excel report", () => {
    const rows = issueRowsOf(item("a"), { jira: { a: [jira("P-2"), jira("P-3")] }, github: { a: [gh(1)] } });
    expect(rows.map((r) => r.child.key)).toEqual(["P-2", "P-3"]);
    expect(rows[0]).toMatchObject({ __issue: true, id: "issue:a:P-2", parentId: "a", last: false });
    expect(rows[1]!.last).toBe(true);
    expect(issueRowsOf(item("b"), { jira: {}, github: { b: [gh(7)] } })[0]).toMatchObject({ last: true, child: { key: "acme/app#7" } });
  });
  it("is empty when nothing is loaded for the initiative", () => {
    expect(issueRowsOf(item("a"), { jira: {}, github: {} })).toEqual([]);
  });
  it("sums the issues up by status group in words", () => {
    const rows = issueRowsOf(item("a"), { jira: { a: [jira("P-2"), jira("P-3", { category: "done", status: "Done" }), jira("P-4", { category: "done", status: "Done" }), jira("P-5", { category: null, status: null })] }, github: {} });
    expect(issueSummary(rows)).toBe("1 To Do · 2 Done · 1 Other");
    expect(issueSummary([])).toBe("");
  });
  it("the chip on the name cell: count, words and whether it is folded; none without issues", () => {
    const kids = { jira: { a: [jira("P-2"), jira("P-3", { category: "done", status: "Done" })] }, github: {} };
    expect(issueInfoOf(item("a"), kids, none)).toEqual({ key: "issues:a", count: 2, summary: "1 To Do · 1 Done", collapsed: false, hidden: 0 });
    expect(issueInfoOf(item("a"), kids, new Set(["issues:a"]))!.collapsed).toBe(true);
    expect(issueInfoOf(item("b"), kids, none)).toBeNull();
  });
  it("puts the issues directly under each initiative, no header row; the initiative row stays; group headers pass through", () => {
    const kids = { jira: { a: [jira("P-2"), jira("P-3")] }, github: { c: [gh(7)] } };
    const out = withIssueRows([header, item("a"), item("b"), item("c")], kids, none);
    expect(out.map((r) => ("__group" in r ? "#" : isIssueRow(r) ? `  ${r.child.key}` : r.id))).toEqual(["#", "a", "  P-2", "  P-3", "b", "c", "  acme/app#7"]);
  });
  it("a folded initiative keeps its row and hides its issues; the others are unchanged; nothing loaded means the rows as they were", () => {
    const kids = { jira: { a: [jira("P-2")], b: [jira("P-9")] }, github: {} };
    const out = withIssueRows([item("a"), item("b")], kids, new Set(["issues:a"]));
    expect(out.map((r) => (isIssueRow(r) ? `  ${r.child.key}` : (r as GridItem).id))).toEqual(["a", "b", "  P-9"]);
    const rows = [item("a")];
    expect(withIssueRows(rows, { jira: {}, github: {} }, none)).toEqual(rows);
  });

  describe("choosing what to show (types, hide done)", () => {
    const mixed = { jira: { a: [jira("P-1", { type: "Epic" }), jira("P-2", { type: "Story" }), jira("P-3", { type: "Bug", category: "done", status: "Done" }), jira("P-4", { type: "Task", category: "done", status: "Cancelled" })], b: [jira("P-9", { type: "Story" })] }, github: {} };
    it("lists only the chosen types, in the tracker's order, and flags the last of those as last", () => {
      const rows = issueRowsOf(item("a"), mixed, { types: ["Epic", "Story"] });
      expect(rows.map((r) => r.child.key)).toEqual(["P-1", "P-2"]);
      expect(rows.map((r) => r.last)).toEqual([false, true]);
      expect(issueRowsOf(item("a"), mixed, { types: [] }).length).toBe(4); // no types chosen means every type
      expect(issueRowsOf(item("a"), mixed, { types: null }).length).toBe(4);
    });
    it("hide done leaves out the issues that are Done or Cancelled in the tracker", () => {
      expect(issueRowsOf(item("a"), mixed, { hideDone: true }).map((r) => r.child.key)).toEqual(["P-1", "P-2"]);
      expect(issueRowsOf(item("a"), mixed, { types: ["Bug", "Story"], hideDone: true }).map((r) => r.child.key)).toEqual(["P-2"]);
    });
    it("the chip counts what is shown and says how many the filter hides; no chip when nothing is left", () => {
      expect(issueInfoOf(item("a"), mixed, none, { hideDone: true })).toMatchObject({ count: 2, hidden: 2 });
      expect(issueInfoOf(item("b"), mixed, none, { types: ["Epic"] })).toBeNull();
    });
    it("withIssueRows applies the filter to every initiative", () => {
      const out = withIssueRows([item("a"), item("b")], mixed, none, { types: ["Story"] });
      expect(out.map((r) => (isIssueRow(r) ? `  ${r.child.key}` : (r as GridItem).id))).toEqual(["a", "  P-2", "b", "  P-9"]);
    });
    it("counts the types of the linked issues, Epic first, before any filter", () => {
      expect(issueTypeCounts([item("a"), item("b")], mixed)).toEqual([{ type: "Epic", count: 1 }, { type: "Story", count: 2 }, { type: "Task", count: 1 }, { type: "Bug", count: 1 }]);
      expect(issueTypeCounts([item("a")], { jira: { a: [jira("P-1", { type: "Spike" }), jira("P-2", { type: "Spike" }), jira("P-3", { type: "Idea" })] }, github: {} })).toEqual([{ type: "Spike", count: 2 }, { type: "Idea", count: 1 }]);
      expect(issueTypeCounts([item("a")], { jira: {}, github: {} })).toEqual([]);
    });
  });
});
