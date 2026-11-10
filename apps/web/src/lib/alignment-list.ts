import { compareQuarters } from "@pv/domain";
import type { SessionState } from "@/lib/alignment";

/**
 * The rows of the Alignment tab (issue #392). Pure functions, no I/O.
 * Admins get every column; everyone else gets only closed or archived sessions that allow results (the database decides which rows they may read),
 * and none of the admin-only values (`stats` is null for them).
 */
export type SessionStats = {
  /** People invited (a total, never per group). */
  invited: number;
  /** People who voted. */
  voted: number;
  /** An invitation or reminder is written and waiting for a person to confirm it. */
  mailingDraft: boolean;
  /** The latest application of the vote to the Stack Rank that was not undone, or null. */
  applied: { at: string; moved: number } | null;
  /** The vote was applied once and then undone. */
  undone: boolean;
};

export type SessionRow = {
  id: string;
  name: string;
  method: "top5_duels" | "coins" | "ice";
  status: SessionState;
  createdAt: string;
  openedAt: string | null;
  closesAt: string | null;
  closedAt: string | null;
  createdBy: string | null;
  /** Initiatives in the vote. */
  initiatives: number;
  /** Their names, for search. */
  itemNames: string;
  /** The Planned Quarter most of its initiatives have (the earlier one on a tie), or null when none has one. */
  quarter: string | null;
  /** Every Planned Quarter its initiatives have, oldest first. */
  quarters: string[];
  /** Initiatives the groups disagreed on (from the stored results); null until the session has results. */
  contested: number | null;
  /** Admin-only values; null for anyone else. */
  stats: SessionStats | null;
};

export const NO_QUARTER = "No planned quarter";
const HOURS_48 = 48 * 3600 * 1000;

/**
 * The planned quarter of a session (Ashu, 2026-11-10: the Planned Quarter of its initiatives, not the quarter it closed in): the Planned Quarter
 * most of its initiatives have, the earlier one on a tie, plus every quarter that occurs. Initiatives without one do not count.
 */
export function plannedQuarters(list: (string | null | undefined)[]): { quarter: string | null; quarters: string[] } {
  const count = new Map<string, number>();
  for (const q of list) if (q) count.set(q, (count.get(q) ?? 0) + 1);
  const quarters = [...count.keys()].sort(compareQuarters);
  let best: string | null = null;
  for (const q of quarters) if (best === null || count.get(q)! > count.get(best)!) best = q;
  return { quarter: best, quarters };
}
export const quarterText = (r: Pick<SessionRow, "quarter">): string => r.quarter ?? NO_QUARTER;

export type Need = "no-participants" | "confirm-mailing" | "closing-soon" | "not-applied";
export const NEED_LABEL: Record<Need, string> = {
  "no-participants": "Draft with nobody invited",
  "confirm-mailing": "Mailing waiting for your confirm",
  "closing-soon": "Closing within 48 hours",
  "not-applied": "Closed, not applied yet",
};

/** What needs an admin's attention on one session. Empty for people who are not admins (they have no stats). */
export function needsYou(r: SessionRow, now: Date): Need[] {
  const s = r.stats;
  if (!s) return [];
  const out: Need[] = [];
  if (r.status === "draft" && s.invited === 0) out.push("no-participants");
  if (s.mailingDraft && (r.status === "draft" || r.status === "open")) out.push("confirm-mailing");
  if (r.status === "open" && r.closesAt) {
    const left = Date.parse(r.closesAt) - now.getTime();
    if (left > 0 && left <= HOURS_48) out.push("closing-soon");
  }
  if ((r.status === "closed" || r.status === "archived") && s.voted > 0 && !s.applied && !s.undone) out.push("not-applied");
  return out;
}

export type AppliedFilter = "" | "applied" | "not-applied" | "undone";
export type Filters = { q: string; status: "" | SessionState; method: "" | SessionRow["method"]; quarter: string; applied: AppliedFilter; need: "" | Need; showArchived: boolean; createdBy: string };
export const NO_FILTERS: Filters = { q: "", status: "", method: "", quarter: "", applied: "", need: "", showArchived: false, createdBy: "" };

/** Whether a session is applied, not applied or undone (for sessions with results only; others are none of these). */
export function appliedState(r: SessionRow): Exclude<AppliedFilter, ""> | null {
  if (!r.stats || (r.status !== "closed" && r.status !== "archived")) return null;
  return r.stats.applied ? "applied" : r.stats.undone ? "undone" : "not-applied";
}

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);

/** Rows that match every filter. Search finds a word in the name of the session or in the name of one of its initiatives. Archived ones only when asked for. */
export function filterRows(rows: SessionRow[], f: Filters, now: Date): SessionRow[] {
  const w = words(f.q);
  return rows.filter((r) => {
    if (r.status === "archived" && !f.showArchived && f.status !== "archived") return false;
    if (f.status && r.status !== f.status) return false;
    if (f.method && r.method !== f.method) return false;
    if (f.quarter && !(f.quarter === NO_QUARTER ? r.quarter === null : r.quarters.includes(f.quarter))) return false;
    if (f.applied && appliedState(r) !== f.applied) return false;
    if (f.need && !needsYou(r, now).includes(f.need)) return false;
    if (f.createdBy && r.createdBy !== f.createdBy) return false;
    if (w.length > 0) {
      const hay = `${r.name} ${r.itemNames}`.toLowerCase();
      if (!w.every((x) => hay.includes(x))) return false;
    }
    return true;
  });
}

export type SortKey = "name" | "status" | "created" | "opened" | "closed" | "quarter" | "initiatives" | "invited" | "voted" | "participation" | "contested" | "applied";
const STATUS_ORDER: Record<SessionState, number> = { open: 0, draft: 1, closed: 2, archived: 3 };
export const participation = (s: SessionStats | null): number | null => (s && s.invited > 0 ? Math.round((s.voted / s.invited) * 100) : null);

const value = (r: SessionRow, k: SortKey): string | number | null => {
  switch (k) {
    case "name": return r.name.toLowerCase();
    case "status": return STATUS_ORDER[r.status];
    case "created": return Date.parse(r.createdAt);
    case "opened": return r.openedAt ? Date.parse(r.openedAt) : null;
    case "closed": { const t = r.closedAt ?? r.closesAt; return t ? Date.parse(t) : null; }
    case "quarter": return r.quarter;
    case "initiatives": return r.initiatives;
    case "invited": return r.stats?.invited ?? null;
    case "voted": return r.stats?.voted ?? null;
    case "participation": return participation(r.stats);
    case "contested": return r.contested;
    case "applied": return r.stats?.applied ? Date.parse(r.stats.applied.at) : null;
  }
};

/** Sorted copy. Empty values go last in either direction, and equal values keep the newest session first so the order is the same every time. */
export function sortRows(rows: SessionRow[], key: SortKey, dir: "asc" | "desc"): SessionRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = value(a, key), y = value(b, key);
    if (x === null && y !== null) return 1;
    if (y === null && x !== null) return -1;
    let c = 0;
    if (x !== null && y !== null) c = key === "quarter" ? compareQuarters(String(x), String(y)) : typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return c !== 0 ? c * sign : Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id);
  });
}

export type Summary = { sessions: number; invited: number; voted: number; participation: number | null; initiativesRanked: number; applied: number };

/**
 * Totals for the rows shown, for admins. Team-level only: nothing here is about a person, and no number is per group.
 * "Initiatives ranked" counts the initiatives of sessions that have closed.
 */
export function summarize(rows: SessionRow[]): Summary {
  let invited = 0, voted = 0, ranked = 0, applied = 0;
  for (const r of rows) {
    invited += r.stats?.invited ?? 0;
    voted += r.stats?.voted ?? 0;
    if (r.status === "closed" || r.status === "archived") ranked += r.initiatives;
    if (r.stats?.applied) applied++;
  }
  return { sessions: rows.length, invited, voted, participation: invited > 0 ? Math.round((voted / invited) * 100) : null, initiativesRanked: ranked, applied };
}

/** The planned quarters present in the rows (any of a session's initiatives), oldest first, with "No planned quarter" last. */
export function quarterOptions(rows: SessionRow[]): string[] {
  const set = new Set(rows.flatMap((r) => r.quarters));
  const real = [...set].sort(compareQuarters);
  return rows.some((r) => r.quarter === null) ? [...real, NO_QUARTER] : real;
}

/** The counts on the "needs you" chips. */
export function needCounts(rows: SessionRow[], now: Date): Record<Need, number> {
  const out: Record<Need, number> = { "no-participants": 0, "confirm-mailing": 0, "closing-soon": 0, "not-applied": 0 };
  for (const r of rows) for (const n of needsYou(r, now)) out[n]++;
  return out;
}
