// What the Projects section of the Jira page says after a link or unlink (issue: Ashu, 2026-11-18, "it bounces back and I get no message"). The database
// refuses an unlink while initiatives of the project are linked to Jira issues (PV008); that used to come out as the generic "Something went wrong".

/** The status shown after an unlink that the database refused. */
export function unlinkStatus(code: string | undefined | null): string {
  if (code === "PV008") return "unlink-linked";
  if (code === "PV010") return "unlink-delete-failed";
  if (code === "42501") return "not-admin";
  return "error";
}

/** Statuses that mean "nothing was changed": shown as an alert, not as a note. */
export const PROBLEM_STATUSES: ReadonlySet<string> = new Set(["error", "not-admin", "unlink-linked", "unlink-delete-failed", "link-unavailable", "link-type", "link-types", "link-tracker", "link-taken"]);
/** The page jumps to the message: the table is below it, and a message above the fold looks like nothing happened. */
export const STATUS_ANCHOR = "jira-status";

export type ReleaseChoice = "keep" | "delete";
/** What the form said; anything but "delete" keeps the initiatives (the safe choice). */
export const releaseChoice = (v: unknown): ReleaseChoice => (v === "delete" ? "delete" : "keep");
/** The words of the unlink confirmation (a project with initiatives linked to Jira issues): the consequences in plain terms, with the exact count. */
export function unlinkConfirmation(n: number, choice: ReleaseChoice): { title: string; consequences: string[]; button: string; danger: boolean } {
  const noun = n === 1 ? "initiative" : "initiatives";
  const common = ["Jira is not changed: its issues, labels and descriptions stay as they are.", "The Jira links, issue trees and the Jira tab of the initiatives are removed."];
  return choice === "delete"
    ? { title: `Unlink and delete ${n} ${noun}`, consequences: [`${n === 1 ? "The initiative moves" : `All ${n} initiatives move`} to the Trash. You can restore ${n === 1 ? "it" : "them"} for 30 days, then ${n === 1 ? "it is" : "they are"} deleted for good.`, ...common], button: `Unlink and delete ${n} ${noun}`, danger: true }
    : { title: `Unlink and keep ${n} ${noun}`, consequences: [`${n === 1 ? "The initiative stays" : `All ${n} initiatives stay`} in Product Velocity, with everything except what Jira gave ${n === 1 ? "it" : "them"}.`, "Build Status and the delivery counts are cleared: they came from Jira and nothing feeds them any more.", ...common, "If you link the project again and pull the issues in, Product Velocity re-links each one to its initiative by the marker label it put on the issue, so no duplicates appear."], button: `Unlink and keep ${n} ${noun}`, danger: false };
}
