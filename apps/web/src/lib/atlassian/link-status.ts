// What the Projects section of the Jira page says after a link or unlink (issue: Ashu, 2026-11-18, "it bounces back and I get no message"). The database
// refuses an unlink while initiatives of the project are linked to Jira issues (PV008); that used to come out as the generic "Something went wrong".

/** The status shown after an unlink that the database refused. */
export function unlinkStatus(code: string | undefined | null): string {
  if (code === "PV008") return "unlink-linked";
  if (code === "42501") return "not-admin";
  return "error";
}

/** Statuses that mean "nothing was changed": shown as an alert, not as a note. */
export const PROBLEM_STATUSES: ReadonlySet<string> = new Set(["error", "not-admin", "unlink-linked", "link-unavailable", "link-type", "link-types", "link-tracker", "link-taken"]);
/** The page jumps to the message: the table is below it, and a message above the fold looks like nothing happened. */
export const STATUS_ANCHOR = "jira-status";
