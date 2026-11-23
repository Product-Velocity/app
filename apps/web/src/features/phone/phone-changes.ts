import type { ChangeRowData } from "@pv/domain";

/**
 * The two phone feeds (issue #635): the initiatives that changed most recently, and the latest changes that came from the tracker.
 * Pure rules over the rows of buildChangeRows (the member-readable change_feed). Rows are about initiatives; nothing is counted per person (rule 8).
 */
export const CHANGED_LIMIT = 15;
export const TRACKER_LIMIT = 10;

/** Initiative-level changes. Build Status and linked-issue status are the tracker's and belong to the Tracker feed. */
const INITIATIVE_TYPES = new Set(["phase", "initiative-status", "health"]);

export type ChangedInitiative = { itemId: string; code: string; name: string; at: string; type: ChangeRowData["type"]; label: string; from: string | null; to: string | null; tone: ChangeRowData["tone"]; more: number };

const LABEL: Record<string, string> = { phase: "Phase", "initiative-status": "Status", health: "Health" };

/**
 * One entry per initiative with its newest change and how many more there were in the period, at most `limit`. Input is newest first. The initiatives the person
 * follows come first (newest first among them), then the rest, newest first: a followed initiative is never pushed out by newer changes elsewhere.
 */
export function latestChangedInitiatives(rows: readonly ChangeRowData[], limit = CHANGED_LIMIT, followed: ReadonlySet<string> = new Set()): ChangedInitiative[] {
  const by = new Map<string, ChangedInitiative>();
  for (const r of rows) {
    if (!INITIATIVE_TYPES.has(r.type)) continue;
    const seen = by.get(r.itemId);
    if (seen) { seen.more += 1; continue; }
    by.set(r.itemId, { itemId: r.itemId, code: r.code, name: r.name, at: r.at, type: r.type, label: LABEL[r.type] ?? r.type, from: r.from, to: r.to, tone: r.tone, more: 0 });
  }
  const all = [...by.values()];
  return [...all.filter((c) => followed.has(c.itemId)), ...all.filter((c) => !followed.has(c.itemId))].slice(0, limit);
}

export type TrackerChange = Pick<ChangeRowData, "id" | "itemId" | "code" | "name" | "at" | "from" | "to" | "tone" | "source" | "tracker" | "issue" | "alsoBuild" | "type">;

/** Changes the tracker made (linked issue status, Build Status), newest first, at most `limit`, after the optional search. Input is newest first. */
export function trackerChanges(rows: readonly ChangeRowData[], query = "", limit = TRACKER_LIMIT): TrackerChange[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const out: TrackerChange[] = [];
  for (const r of rows) {
    if (!r.trackerDriven) continue;
    if (words.length > 0) {
      const hay = `${r.code} ${r.name} ${r.issue?.key ?? ""} ${r.issue?.title ?? ""} ${r.from ?? ""} ${r.to ?? ""} ${r.source}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
    }
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", then the date. */
export function ago(at: string, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - Date.parse(at)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86_400);
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** "Health: On track → At risk" (a first value reads "Health: At risk"). */
export const changeText = (c: { label: string; from: string | null; to: string | null }) => (c.from ? `${c.label}: ${c.from} → ${c.to ?? "empty"}` : `${c.label}: ${c.to ?? "empty"}`);
