import { describe, expect, it } from "vitest";
import { buildGroupedRows, INITIATIVE_GROUP, type GroupRow } from "@pv/domain";
import { isIssueRow, issueRowsOf, issueSummary } from "./issue-rows";
import type { GridItem, IssueTreeRow, JiraTreeRow } from "./types";

const item = (id: string, name = id) => ({ id, item_code: `R-${id}`, initiative_name: name }) as unknown as GridItem;
const jira = (key: string, o: Partial<JiraTreeRow> = {}): JiraTreeRow => ({ key, parentKey: "P-1", level: 1, position: 0, title: `T ${key}`, type: "Epic", status: "To Do", category: "new", assignee: null, url: null, updatedAt: null, ...o });
const gh = (n: number): IssueTreeRow => ({ repo: "acme/app", number: n, parentNumber: null, level: 1, title: `Epic ${n}`, state: "open", stateReason: null, assignees: ["ana"], createdBy: "app", updatedAt: "2026-11-12T10:00:00Z" });
const label = (_f: string, v: unknown) => String(v ?? "No value");

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
  it("grouped by the initiative level, each initiative is a header with its issues beneath it", () => {
    const kids = { jira: { a: [jira("P-2")] }, github: {} };
    const out = buildGroupedRows([item("a", "Alpha"), item("b", "Beta")], INITIATIVE_GROUP, new Set(), label, null, { children: (r) => issueRowsOf(r, kids), summary: issueSummary });
    expect(out.map((r) => ("__group" in r ? `# ${(r as GroupRow).label} ${(r as GroupRow).count}` : isIssueRow(r) ? `  ${r.child.key}` : "item"))).toEqual(["# R-a Alpha 1", "  P-2", "# R-b Beta 0"]);
  });
});
