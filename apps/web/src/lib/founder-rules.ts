/** Rules for the personal emails from Ashu (no server access here, so they can be tested). */
export const FOLLOWUP_AFTER_DAYS = 2;
export const FOLLOWUP_WINDOW_DAYS = 14; // never reaches back further: an old empty workspace is not nudged when this goes live
export const FOLLOWUP_PER_RUN = 20;

/** The first word of a full name, or "there" so the greeting never reads "Hi ,". */
export function firstNameOf(full: unknown): string {
  const first = String(typeof full === "string" ? full : "").trim().split(/\s+/)[0] ?? "";
  return first.length > 0 && first.length <= 40 ? first : "there";
}

/** Old enough, not too old, and nothing done yet: no initiative and no GitHub or Jira connection. */
export function isFollowupCandidate(i: { createdAt: string; now: number; items: number; trackers: number }): boolean {
  const age = (i.now - Date.parse(i.createdAt)) / 86_400_000;
  return age >= FOLLOWUP_AFTER_DAYS && age <= FOLLOWUP_WINDOW_DAYS && i.items === 0 && i.trackers === 0;
}
