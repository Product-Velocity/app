import type { SourceControl, SubIssue } from "./source-control";

/** One row of an initiative's issue tree: level 1 is an epic (sub-issue of the tracking issue), level 2 a task (sub-issue of an epic). */
export type TreeNode = SubIssue & { level: 1 | 2; parentNumber: number | null };

/** GitHub allows 100 sub-issues per parent and 8 levels; we read two below the initiative. */
export const SUB_ISSUE_LIMIT = 100;
export const SUB_ISSUE_WARN_AT = 90;

/** Reads epics and their tasks. Returns null when the repository does not offer sub-issues for this issue. */
export async function readIssueTree(sc: SourceControl, installationId: number, repo: string, number: number): Promise<TreeNode[] | null> {
  const epics = await sc.listSubIssues(installationId, repo, number);
  if (epics === null) return null;
  const out: TreeNode[] = epics.map((e) => ({ ...e, level: 1, parentNumber: null }));
  for (const e of epics) {
    const tasks = await sc.listSubIssues(installationId, e.repo, e.number);
    for (const t of tasks ?? []) out.push({ ...t, level: 2, parentNumber: e.number });
  }
  return out;
}

export type TreeSummary = { total: number; closed: number; progressPct: number | null; nearLimit: boolean };

/**
 * Delivery counts. Work is counted at the leaves: a task counts, an epic counts only while it has no tasks.
 * Progress is closed / total (not-planned closures leave the total), null while nothing is planned.
 */
export function summariseTree(nodes: TreeNode[]): TreeSummary {
  const withTasks = new Set(nodes.filter((n) => n.level === 2).map((n) => n.parentNumber));
  const leaves = nodes.filter((n) => n.level === 2 || !withTasks.has(n.number)).filter((n) => !(n.state === "closed" && n.stateReason === "not_planned"));
  const closed = leaves.filter((n) => n.state === "closed").length;
  const perParent = new Map<number | null, number>();
  for (const n of nodes) perParent.set(n.parentNumber, (perParent.get(n.parentNumber) ?? 0) + 1);
  return { total: leaves.length, closed, progressPct: leaves.length === 0 ? null : Math.round((closed / leaves.length) * 100), nearLimit: [...perParent.values()].some((c) => c >= SUB_ISSUE_WARN_AT) };
}
