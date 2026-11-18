/** Which colour a status pill gets. The words always show; colour is only an extra (brand guide, Health and status). */
export type Tone = "good" | "risk" | "bad" | "severe" | "info" | "neutral" | "stage" | "stage-muted";

const GOOD = ["on track", "done", "completed", "complete", "go", "passed", "aligned", "passing", "synced", "on target", "exceeded"];
const RISK = ["at risk", "go with conditions", "passed with conditions", "hold", "held", "in review", "waiting for approver", "awaiting engineering", "draft proposed", "contested", "pending", "behind", "on hold", "deferred"];
const BAD = ["off track", "delayed", "stop", "stopped", "kill", "failing", "error", "conflict", "overdue", "missed", "failed", "rejected", "revoked"];
const INFO = ["in progress", "active", "included", "committed"];
/** Blocked is the hardest problem: a darker red than Delayed. */
const SEVERE = ["blocked"];

const TONES = new Map<string, Tone>([
  ...GOOD.map((v) => [v, "good"] as const),
  ...RISK.map((v) => [v, "risk"] as const),
  ...BAD.map((v) => [v, "bad"] as const),
  ...INFO.map((v) => [v, "info"] as const),
  ...SEVERE.map((v) => [v, "severe"] as const),
]);

/** Backlog, not started, cancelled, unknown: grey. (Active is blue, On hold and Deferred amber: decision 2026-11-18-status-pill-colours.) */
export const statusTone = (value: string): Tone => TONES.get(value.trim().toLowerCase()) ?? "neutral";

/** The single-status fields shown as pills (Initiative Phase as an outlined pill). */
export const PILL_FIELDS: ReadonlySet<string> = new Set([
  "status", "initiative_status", "decision", "gate_status", "alignment_status", "align_why", "align_what", "align_how", "align_when",
  "initiative_phase", "outcome_status", "ci_status", "sync_state", "breakdown_status", "planning_status",
]);

/** Initiative Phase is an outlined pill, never a fill: where an initiative is, not how it is going. Completed and Sunset are muted. */
export const phaseTone = (value: string): Tone => (["completed", "sunset"].includes(value.trim().toLowerCase()) ? "stage-muted" : "stage");

/** The tone for a field's value: phase pills are outlined, every other pill follows its words. */
export const toneFor = (field: string, value: string): Tone => (field === "initiative_phase" ? phaseTone(value) : statusTone(value));
