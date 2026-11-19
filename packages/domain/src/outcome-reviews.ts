/**
 * The 30, 60 and 90 day outcome reviews after Roll-out (Ashu, chat 2026-11-19; docs/decisions/2026-11-19-outcome-reviews.md). Not a gate. Each checkpoint is due that many
 * days after Start Roll-Out. A row exists once someone asked for the metrics (requested) and is filled when they are recorded. Pure rules; nothing about a person's performance.
 */
export const OUTCOME_CHECKPOINTS = [30, 60, 90] as const;
export type OutcomeCheckpoint = (typeof OUTCOME_CHECKPOINTS)[number];
/** A review shows as due this many days before its date, so there is time to ask. */
export const OUTCOME_LEAD_DAYS = 7;

export type OutcomeReview = {
  id?: string; item_id: string; at_days: number; due_on: string;
  requested_at: string | null; requested_to?: string | null;
  realised_kr_value: number | string | null; adoption_pct: number | string | null; notes: string | null; recorded_at: string | null;
};

const dayOf = (v: unknown) => (typeof v === "string" && v !== "" ? Math.round(Date.parse(`${v.slice(0, 10)}T00:00:00Z`) / 86_400_000) : NaN);

/** The date a checkpoint is due (YYYY-MM-DD), or null when the initiative has no Start Roll-Out. */
export function outcomeDueOn(startRollout: unknown, days: number): string | null {
  const d = dayOf(startRollout);
  return Number.isNaN(d) ? null : new Date((d + days) * 86_400_000).toISOString().slice(0, 10);
}

/** What the person should do next about the outcome reviews of one initiative, or null. The earliest checkpoint nobody has recorded decides. */
export type OutcomeNext =
  | { kind: "request"; days: OutcomeCheckpoint; dueOn: string; overdueDays: number }
  | { kind: "record"; days: OutcomeCheckpoint; dueOn: string };

export function nextOutcomeStep(row: object, reviews: readonly OutcomeReview[], todayNum: number): OutcomeNext | null {
  const r = row as { initiative_phase?: unknown; initiative_status?: unknown; start_rollout?: unknown };
  if (r.initiative_status === "Cancelled" || (r.initiative_phase !== "Roll-out" && r.initiative_phase !== "Completed")) return null;
  for (const days of OUTCOME_CHECKPOINTS) {
    const dueOn = outcomeDueOn(r.start_rollout, days);
    if (!dueOn) return null;
    const rev = reviews.find((x) => x.at_days === days);
    if (rev?.recorded_at) continue;
    if (rev?.requested_at) return { kind: "record", days, dueOn };
    const due = dayOf(dueOn);
    return due - todayNum <= OUTCOME_LEAD_DAYS ? { kind: "request", days, dueOn, overdueDays: Math.max(0, todayNum - due) } : null;
  }
  return null;
}
