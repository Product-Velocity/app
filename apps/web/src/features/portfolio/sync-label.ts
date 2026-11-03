import type { Lookups } from "./types";

// What the Sync button says: the platform(s) the work is actually synced with, not a fixed word. A platform counts when the workspace is
// connected to it; among those, the ones the items in scope belong to (by their project's tracker; a project without one behaves as GitHub,
// as the sync itself does). If the scope has none of the connected platforms, all connected ones are named.

export type Platform = "GitHub" | "Jira";

export function connectedPlatforms(l: Pick<Lookups, "github" | "trackers">): Platform[] {
  return [...(l.github?.connected ? (["GitHub"] as const) : []), ...(l.trackers?.jira ? (["Jira"] as const) : [])];
}

/** The platforms a sync of these projects goes to. */
export function syncPlatforms(l: Pick<Lookups, "github" | "trackers">, projectIds: readonly string[]): Platform[] {
  const connected = connectedPlatforms(l);
  const scope = new Set<Platform>();
  for (const id of new Set(projectIds)) scope.add((l.trackers?.projectTracker[id] ?? "github") === "jira" ? "Jira" : "GitHub");
  const hit = connected.filter((p) => scope.has(p));
  return hit.length > 0 ? hit : connected;
}

export const platformsText = (p: readonly Platform[]) => p.join(" and ");
/** "Sync with Jira", "Sync 3 with GitHub and Jira"; "Sync with GitHub or Jira" (disabled) when nothing is connected yet. */
export function syncLabel(p: readonly Platform[], count = 0): string {
  if (p.length === 0) return "Sync with GitHub or Jira";
  return count > 0 ? `Sync ${count} with ${platformsText(p)}` : `Sync with ${platformsText(p)}`;
}
export const syncTitle = (p: readonly Platform[]) => (p.length === 0 ? "An admin connects GitHub or Jira in Settings, Integrations" : `Checks ${platformsText(p)} for changes and sends yours. Nothing is sent until you confirm.`);
