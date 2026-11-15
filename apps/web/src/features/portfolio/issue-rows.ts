import { childrenOf, type ReportChild, type ReportChildren } from "./export-xlsx-children";
import type { GridItem } from "./types";

/** A tracker issue (epic, story, task) shown as a row under its initiative when "Show issues" is on. Read only: it is never selected or edited. */
export type IssueRow = { __issue: true; id: string; parentId: string; child: ReportChild; /** The last issue of its initiative: its branch line stops at the row. */ last: boolean };

export const isIssueRow = (r: unknown): r is IssueRow => !!r && typeof r === "object" && (r as { __issue?: boolean }).__issue === true;

/** An initiative's linked tracker issues as rows (Jira first, else GitHub, the first level, as in the Excel report with epics). None when there are none or they are not loaded yet. */
export function issueRowsOf(row: GridItem, children: ReportChildren): IssueRow[] {
  const kids = childrenOf(row, children);
  return kids.map((child, i) => ({ __issue: true, id: `issue:${row.id}:${child.key}`, parentId: row.id, child, last: i === kids.length - 1 }));
}

/** The issues of an initiative in words by tracker status group: "1 To Do · 2 In Progress · 1 Done"; issues without a status group are counted as "Other". */
export function issueSummary(rows: readonly IssueRow[]): string {
  const order = ["To Do", "In Progress", "Done", "Other"] as const;
  const counts = new Map<string, number>();
  for (const r of rows) { const g = r.child.group || "Other"; counts.set(g, (counts.get(g) ?? 0) + 1); }
  return order.filter((g) => counts.has(g)).map((g) => `${counts.get(g)} ${g}`).join(" · ");
}

/** The key of an initiative's issues in the grid's collapsed set. */
export const issuesKey = (initiativeId: string) => `issues:${initiativeId}`;

/** What the chip on an initiative's name cell shows: how many issues, in words, and whether they are folded away. Null when it has none. */
export type IssueInfo = { key: string; count: number; summary: string; collapsed: boolean };
export function issueInfoOf(row: GridItem, children: ReportChildren, collapsed: ReadonlySet<string>): IssueInfo | null {
  const rows = issueRowsOf(row, children);
  if (rows.length === 0) return null;
  const key = issuesKey(row.id);
  return { key, count: rows.length, summary: issueSummary(rows), collapsed: collapsed.has(key) };
}

/**
 * "Show issues": the initiative keeps its own data row and its issues follow it as rows, unless the initiative's issues are folded away (the chip on its
 * name cell). Group headers pass through.
 */
export function withIssueRows<T extends GridItem | { __group: true }>(rows: readonly T[], children: ReportChildren, collapsed: ReadonlySet<string>): (T | IssueRow)[] {
  const out: (T | IssueRow)[] = [];
  for (const r of rows) {
    out.push(r);
    if ("__group" in r) continue;
    if (collapsed.has(issuesKey((r as GridItem).id))) continue;
    out.push(...issueRowsOf(r as GridItem, children));
  }
  return out;
}
