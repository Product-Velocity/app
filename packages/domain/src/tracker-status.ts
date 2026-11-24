/**
 * Tracker Status (field N49, issue #480): the status of the initiative's linked issue in the tracker's own words, next to Build Status, which is
 * Product Velocity's own and the same for every tracker. Jira: the issue's status name. GitHub: the board's Status when the initiative is on a board (the same
 * words as Delivery Status), otherwise the state of the issue. An initiative has one tracker; if it somehow has both, Jira's status is shown.
 * An initiative of a read-only Jira project has no Jira issue of its own, only the epics listed on it (issue #656): its Tracker Status says how many
 * of those epics are done ("3 of 11 epics done"), coloured by the same rule Build Status follows (all done, none started, otherwise in progress).
 */
export type GhIssueState = "open" | "closed_completed" | "closed_not_planned";

const GH_STATE: Record<GhIssueState, string> = { open: "Open", closed_completed: "Closed", closed_not_planned: "Closed (not planned)" };

export function trackerStatusOf(link: { jiraStatus?: string | null; boardStatus?: string | null; ghState?: string | null }): string | null {
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return text(link.jiraStatus) ?? text(link.boardStatus) ?? (link.ghState && link.ghState in GH_STATE ? GH_STATE[link.ghState as GhIssueState] : null);
}

export type EpicCategory = "new" | "indeterminate" | "done" | null;

/** The Tracker Status of an initiative that only has epics read from Jira, and the category that colours it. Null when no epic has been read. */
export function epicsStatusOf(categories: readonly EpicCategory[]): { text: string; category: "new" | "indeterminate" | "done" | null } | null {
  if (categories.length === 0) return null;
  const done = categories.filter((c) => c === "done").length;
  const known = categories.filter((c): c is "new" | "indeterminate" | "done" => c !== null);
  const category = known.length === 0 ? null : known.every((c) => c === "done") ? "done" : known.every((c) => c === "new") ? "new" : "indeterminate";
  return { text: `${done} of ${categories.length} ${categories.length === 1 ? "epic" : "epics"} done`, category };
}
