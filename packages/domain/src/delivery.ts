// Computed delivery measures (field dictionary N37 and N39). Pure, so the rules are tested without a database or GitHub.

const DAY = 86_400_000;
const day = (s: string | null | undefined): number | null => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const t = Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Number.isNaN(t) ? null : t;
};

/**
 * Schedule Variance (pp): Delivery Progress % minus the share of time elapsed between Planned Start and G2M Date (est), in percentage
 * points. Negative = behind plan. Null without a progress figure, without both dates, or when the end is not after the start.
 * Before the start 0% of the time has elapsed; after the end 100%.
 */
export function scheduleVariancePp(progressPct: number | null | undefined, plannedStart: string | null | undefined, g2mDateEst: string | null | undefined, today: string): number | null {
  if (typeof progressPct !== "number" || !Number.isFinite(progressPct)) return null;
  const start = day(plannedStart);
  const end = day(g2mDateEst);
  const now = day(today);
  if (start === null || end === null || now === null || end <= start) return null;
  const elapsed = Math.min(Math.max((now - start) / (end - start), 0), 1) * 100;
  const pp = Math.round(progressPct - elapsed);
  return pp === 0 ? 0 : pp; // never "-0"
}

/** How long an open child issue may be quiet before it counts as stale (the dictionary's default; a project setting may replace it later). */
export const STALE_AFTER_DAYS = 14;

export type ChildIssue = { state: "open" | "closed"; updatedAt?: string | null; labels?: readonly string[] };
const isBlocked = (labels: readonly string[] | undefined) => (labels ?? []).some((l) => l.trim().toLowerCase() === "blocked");

/**
 * Blocked Issues (#) and Stale Issues (#) over the open child issues of an initiative (epics and tasks, all levels).
 * Blocked: carries the "blocked" label (the blocked-by relation is not read yet). Stale: no activity for `staleAfterDays` (a child whose
 * last activity is unknown is not counted). Closed work is never blocked or stale.
 */
export function countBlockedStale(children: readonly ChildIssue[], now: Date, staleAfterDays = STALE_AFTER_DAYS): { blocked: number; stale: number } {
  const cutoff = now.getTime() - staleAfterDays * DAY;
  let blocked = 0, stale = 0;
  for (const c of children) {
    if (c.state !== "open") continue;
    if (isBlocked(c.labels)) blocked++;
    const at = c.updatedAt ? Date.parse(c.updatedAt) : NaN;
    if (!Number.isNaN(at) && at < cutoff) stale++;
  }
  return { blocked, stale };
}
