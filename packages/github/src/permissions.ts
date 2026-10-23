// Minimum App permissions and events (docs/04, spike S5 and the 2026-10-23 sandbox results).
// `now` is what the connection needs today; `later` is needed by a later slice and only reported, never blocking.
export type Level = "read" | "write";

export const PERMISSIONS_NOW: Record<string, Level> = { metadata: "read", issues: "write" };
export const PERMISSIONS_LATER: Record<string, Level> = {
  pull_requests: "read",
  checks: "read",
  issue_types: "read",
  organization_projects: "write",
};
export const EVENTS_LATER = ["issues", "sub_issues", "pull_request", "check_run", "check_suite", "release"] as const;

const RANK: Record<string, number> = { read: 1, write: 2, admin: 3 };

/** Permissions that are missing or too weak, as readable strings. */
export function permissionGaps(have: Record<string, string> | undefined, need: Record<string, Level>): string[] {
  return Object.entries(need)
    .filter(([k, level]) => (RANK[have?.[k] ?? ""] ?? 0) < RANK[level]!)
    .map(([k, level]) => `${k} (needs ${level}, has ${have?.[k] ?? "none"})`);
}
