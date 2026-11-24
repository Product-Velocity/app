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

/**
 * The first name to greet a person by, from their profile (Supabase user metadata). Onboarding stores first_name, last_name and the joined
 * full_name; if the person later edits their full name on the Account page, the full name wins (its first word), so a greeting never uses a
 * stale name. Google and GitHub supply full_name or name. Nothing known: "there".
 */
export function firstNameOfUser(meta: Record<string, unknown> | null | undefined): string {
  const full = typeof meta?.full_name === "string" ? meta.full_name.trim() : typeof meta?.name === "string" ? meta.name.trim() : "";
  const first = typeof meta?.first_name === "string" ? meta.first_name.trim() : "";
  const last = typeof meta?.last_name === "string" ? meta.last_name.trim() : "";
  if (first && first.length <= 40 && full && full === [first, last].filter(Boolean).join(" ")) return first; // kept whole: "Mary Ann"
  return firstNameOf(full);
}
