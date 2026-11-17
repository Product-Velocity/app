/**
 * Tracker Status (field N49, issue #480): the status of the initiative's linked issue in the tracker's own words, next to Build Status, which is
 * Product Velocity's own and the same for every tracker. Jira: the issue's status name. GitHub: the board's Status when the initiative is on a board (the same
 * words as Delivery Status), otherwise the state of the issue. An initiative has one tracker; if it somehow has both, Jira's status is shown.
 */
export type GhIssueState = "open" | "closed_completed" | "closed_not_planned";

const GH_STATE: Record<GhIssueState, string> = { open: "Open", closed_completed: "Closed", closed_not_planned: "Closed (not planned)" };

export function trackerStatusOf(link: { jiraStatus?: string | null; boardStatus?: string | null; ghState?: string | null }): string | null {
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return text(link.jiraStatus) ?? text(link.boardStatus) ?? (link.ghState && link.ghState in GH_STATE ? GH_STATE[link.ghState as GhIssueState] : null);
}
