import type { Lookups } from "./types";

/**
 * Where tracker-driven columns come from, in words, for the header note ("from Jira"). It follows the trackers the workspace's projects really use:
 * only Jira, only GitHub, or both (then "GitHub or Jira"). With no project linked yet it follows what is connected.
 */
export function trackerWords(l: Pick<Lookups, "trackers" | "github">): "GitHub" | "Jira" | "GitHub or Jira" {
  const used = new Set(Object.values(l.trackers?.projectTracker ?? {}).filter((t): t is "github" | "jira" => t === "github" || t === "jira"));
  if (used.size === 0) {
    const gh = l.github?.connected === true, jr = l.trackers?.jira === true;
    return gh && !jr ? "GitHub" : jr && !gh ? "Jira" : "GitHub or Jira";
  }
  return used.size === 1 ? (used.has("jira") ? "Jira" : "GitHub") : "GitHub or Jira";
}

export type RowTracker = "github" | "jira" | null;

/** The tracker an initiative belongs to: its own link first, then the tracker of its project (null when it has none). */
export function rowTracker(l: Pick<Lookups, "trackers" | "github" | "jira">, row: { id: string; home_project?: unknown }): RowTracker {
  if (l.jira?.links[row.id]) return "jira";
  if (l.github?.links[row.id]) return "github";
  const t = l.trackers?.projectTracker[String(row.home_project)];
  return t === "github" || t === "jira" ? t : null;
}

/** What an empty tracker-driven value says, in the words of the initiative's own tracker (a Jira initiative is never "Not on GitHub"). */
export function emptyTrackerText(key: string, tracker: RowTracker): string | null {
  if (key === "status") return tracker === "jira" ? "Not in Jira" : tracker === "github" ? "Not on GitHub" : "Not linked";
  if (key === "gh_project_status") return tracker === "jira" ? "Not used in Jira" : "Not on a board";
  return null;
}
