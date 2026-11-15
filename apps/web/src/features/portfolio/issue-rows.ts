import type { GroupRow } from "@pv/domain";
import { childrenOf, type ReportChild, type ReportChildren } from "./export-xlsx-children";
import type { GridItem } from "./types";

/** A tracker issue (epic, story, task) shown as a row under its initiative when "Show issues" is on. Read only: it is never selected or edited. */
export type IssueRow = { __issue: true; id: string; parentId: string; child: ReportChild };

export const isIssueRow = (r: unknown): r is IssueRow => !!r && typeof r === "object" && (r as { __issue?: boolean }).__issue === true;

/** An initiative's linked tracker issues as rows (Jira first, else GitHub, the first level, as in the Excel report with epics). None when there are none or they are not loaded yet. */
export function issueRowsOf(row: GridItem, children: ReportChildren): IssueRow[] {
  return childrenOf(row, children).map((child) => ({ __issue: true, id: `issue:${row.id}:${child.key}`, parentId: row.id, child }));
}

/** The issues of an initiative in words by tracker status group: "1 To Do · 2 In Progress · 1 Done"; issues without a status group are counted as "Other". */
export function issueSummary(rows: readonly IssueRow[]): string {
  const order = ["To Do", "In Progress", "Done", "Other"] as const;
  const counts = new Map<string, number>();
  for (const r of rows) { const g = r.child.group || "Other"; counts.set(g, (counts.get(g) ?? 0) + 1); }
  return order.filter((g) => counts.has(g)).map((g) => `${counts.get(g)} ${g}`).join(" · ");
}

/**
 * "Show issues": under each initiative that has linked tracker issues, a third-level "Issues" header (count, status in words, collapse / expand) and the issues
 * beneath it. The initiative keeps its own data row; collapse state is the key `issues:<initiative id>` in the grid's collapsed set. Group headers pass through.
 */
export function withIssueRows(rows: readonly (GridItem | GroupRow)[], children: ReportChildren, collapsed: ReadonlySet<string>): (GridItem | GroupRow | IssueRow)[] {
  const out: (GridItem | GroupRow | IssueRow)[] = [];
  for (const r of rows) {
    out.push(r);
    if ("__group" in r) continue;
    const kids = issueRowsOf(r, children);
    if (kids.length === 0) continue;
    const key = `issues:${r.id}`;
    const isCollapsed = collapsed.has(key);
    out.push({ __group: true, id: `group:${key}`, key, label: `Issues of ${(r as unknown as { item_code?: string }).item_code ?? "this initiative"}`, count: kids.length, collapsed: isCollapsed, level: 2, healthSummary: issueSummary(kids), unit: "issues", initiativeId: r.id });
    if (!isCollapsed) out.push(...kids);
  }
  return out;
}
