import type { GroupRow } from "@pv/domain";
import { childrenOf, type ReportChild, type ReportChildren } from "./export-xlsx-children";
import type { GridItem } from "./types";

/** A tracker issue (epic, story, task) shown as a row under its initiative when "Show issues" is on. Read only: it is never selected or edited. */
export type IssueRow = { __issue: true; id: string; parentId: string; child: ReportChild };

export const isIssueRow = (r: unknown): r is IssueRow => !!r && typeof r === "object" && (r as { __issue?: boolean }).__issue === true;

/**
 * Puts each initiative's linked tracker issues (Jira first, else GitHub, as in the Excel report) directly under it. Group headers pass through,
 * and an initiative without issues, or whose issues are not loaded yet, gets no rows.
 */
export function withIssueRows(rows: readonly (GridItem | GroupRow)[], children: ReportChildren): (GridItem | GroupRow | IssueRow)[] {
  const out: (GridItem | GroupRow | IssueRow)[] = [];
  for (const r of rows) {
    out.push(r);
    if ("__group" in r) continue;
    for (const child of childrenOf(r, children)) out.push({ __issue: true, id: `issue:${r.id}:${child.key}`, parentId: r.id, child });
  }
  return out;
}
