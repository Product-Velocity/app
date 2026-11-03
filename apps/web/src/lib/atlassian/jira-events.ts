import type { ReceivedLine } from "@/lib/github/push-types";

// The recent-events table of the Jira settings page (decision 2026-11-03-tracker-parity): the Jira twin of GitHub's sync log. Pure helpers.
export type JiraEventRow = { tenant_id: string; link_id: string | null; source: "webhook" | "check" | "manual"; kind: "change" | "run"; issue_key: string | null; summary: string; state: "processed" | "error"; last_error: string | null };

/** "Build Status: Not started → In progress, Jira status: To Do → In Progress", as plain text (Jira values are data, cut to a short length). */
export function describeLines(lines: ReceivedLine[]): string {
  const cut = (v: string | null) => (v ?? "none").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 60);
  return lines.map((l) => `${l.label}: ${cut(l.from)} → ${cut(l.to)}`).join(", ").slice(0, 380);
}

export const sourceLabel = (e: { source: JiraEventRow["source"] }) => (e.source === "webhook" ? "Jira told the app" : e.source === "manual" ? "Found by Check Jira now" : "Found by the daily check");

/** The "Last check" line, in the words GitHub uses. */
export function runSummary(r: { checked: number; changed: number; missing: number; projects: number; failed: number }): string {
  const base = `Checked ${r.checked} linked item(s) in ${r.projects} Jira project(s): ${r.changed} changed, ${r.missing} issue(s) not found.`;
  return (r.failed > 0 ? `${base} ${r.failed} project(s) could not be read.` : base).slice(0, 400);
}
