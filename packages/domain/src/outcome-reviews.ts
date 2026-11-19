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

/**
 * The read-only Outcome columns of one initiative, worked out from its reviews (Ashu 2026-11-19, docs/decisions/2026-11-19-outcome-columns.md and 2026-11-19-outcome-fields-and-draft.md).
 * Three are the dictionary's own fields made live (Outcome Review Date, Realized KR Value, % Realized KR Value); three are the Outcome reviews group.
 */
export type OutcomeStatus = "Not yet due" | "On target" | "Behind" | "Missed" | "Exceeded";
/** The default cut-offs for Outcome Status, as a percent of the way from the KR start to its target (docs/decisions/2026-11-19-outcome-status.md; to be confirmed by Ashu). */
export const OUTCOME_ON_TARGET_PCT = 80;
export const OUTCOME_BEHIND_PCT = 50;
export type OutcomeColumns = {
  outcome_status: OutcomeStatus | null; outcome_review_date: string | null; outcome_reviews_recorded: string | null;
  realized_kr_value: number | null; kr_realized_pct: number | null;
  outcome_latest_adoption: number | null; outcome_kr_progress: number | null;
};
export const OUTCOME_COLUMN_KEYS = ["outcome_status", "outcome_review_date", "outcome_reviews_recorded", "realized_kr_value", "kr_realized_pct", "outcome_latest_adoption", "outcome_kr_progress"] as const;
const EMPTY_OUTCOME: OutcomeColumns = { outcome_status: null, outcome_review_date: null, outcome_reviews_recorded: null, realized_kr_value: null, kr_realized_pct: null, outcome_latest_adoption: null, outcome_kr_progress: null };
const asNumber = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const pct = (x: number) => Math.round(x * 1000) / 10;

/**
 * Only an initiative in Roll-out or Completed that has a Start Roll-Out has reviews; every other row stays empty. Outcome Review Date: the due date of the earliest checkpoint nobody
 * has recorded. Recorded: "2 of 3". Realized KR Value and Latest Adoption: from the latest recorded checkpoint that has that number. % Realized KR Value: value over KR target, in percent
 * (empty with no target, or a target of 0). KR Progress: (value minus KR start) over (KR target minus KR start), in percent, only when all three numbers are there and start and target differ.
 */
export function outcomeColumns(row: object, reviews: readonly OutcomeReview[], today?: Date): OutcomeColumns {
  const r = row as { initiative_phase?: unknown; initiative_status?: unknown; start_rollout?: unknown; kr_start?: unknown; kr_target?: unknown };
  if (r.initiative_status === "Cancelled" || (r.initiative_phase !== "Roll-out" && r.initiative_phase !== "Completed") || !outcomeDueOn(r.start_rollout, 30)) return EMPTY_OUTCOME;
  const recorded = reviews.filter((x) => x.recorded_at).sort((a, b) => b.at_days - a.at_days);
  const next = OUTCOME_CHECKPOINTS.find((d) => !recorded.some((x) => x.at_days === d));
  const value = recorded.map((x) => asNumber(x.realised_kr_value)).find((v) => v !== null) ?? null;
  const adoption = recorded.map((x) => asNumber(x.adoption_pct)).find((v) => v !== null) ?? null;
  const start = asNumber(r.kr_start), target = asNumber(r.kr_target);
  const progress = value !== null && start !== null && target !== null && target !== start ? (value - start) / (target - start) : null;
  return {
    outcome_status: outcomeStatus(recorded.length, recorded.some((x) => x.at_days === 90), progress, outcomeDueOn(r.start_rollout, 30), today),
    outcome_review_date: next ? outcomeDueOn(r.start_rollout, next) : null,
    outcome_reviews_recorded: `${recorded.length} of ${OUTCOME_CHECKPOINTS.length}`,
    realized_kr_value: value,
    kr_realized_pct: value !== null && target !== null && target !== 0 ? pct(value / target) : null,
    outcome_latest_adoption: adoption,
    outcome_kr_progress: value !== null && start !== null && target !== null && target !== start ? pct((value - start) / (target - start)) : null,
  };
}

/**
 * Outcome Status, the result of the latest outcome review (default rule, to be confirmed; docs/decisions/2026-11-19-outcome-status.md). Before the first review is due: Not yet due.
 * Once numbers are recorded, by how far the latest realised value has come from the KR start to its target: above 100% Exceeded; OUTCOME_ON_TARGET_PCT or more On target; below that
 * Behind, except that after the 90 day review a result under OUTCOME_BEHIND_PCT is Missed. Empty when it cannot be worked out (no start, target or value) or when the first review is due and nothing is recorded.
 */
function outcomeStatus(recordedCount: number, ninetyRecorded: boolean, progress: number | null, firstDue: string | null, today?: Date): OutcomeStatus | null {
  if (recordedCount === 0) {
    if (!firstDue || !today) return null;
    return dayOf(firstDue) > Math.floor(today.getTime() / 86_400_000) ? "Not yet due" : null;
  }
  if (progress === null) return null;
  if (progress > 1) return "Exceeded";
  if (progress >= OUTCOME_ON_TARGET_PCT / 100) return "On target";
  return ninetyRecorded && progress < OUTCOME_BEHIND_PCT / 100 ? "Missed" : "Behind";
}
