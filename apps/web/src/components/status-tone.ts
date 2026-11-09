/** Which colour a status pill gets. The words always show; colour is only an extra (brand guide, Health and status). */
export type Tone = "good" | "risk" | "bad" | "info" | "neutral";

const GOOD = ["on track", "done", "completed", "complete", "active", "go", "passed", "aligned", "passing", "synced", "on target", "exceeded"];
const RISK = ["at risk", "go with conditions", "passed with conditions", "hold", "held", "in review", "waiting for approver", "awaiting engineering", "draft proposed", "contested", "pending", "behind"];
const BAD = ["off track", "delayed", "blocked", "stop", "stopped", "kill", "failing", "error", "conflict", "overdue", "missed", "failed", "rejected", "revoked"];
const INFO = ["in progress", "included", "committed"];

const TONES = new Map<string, Tone>([
  ...GOOD.map((v) => [v, "good"] as const),
  ...RISK.map((v) => [v, "risk"] as const),
  ...BAD.map((v) => [v, "bad"] as const),
  ...INFO.map((v) => [v, "info"] as const),
]);

/** Not started, paused, cancelled, unknown: grey. */
export const statusTone = (value: string): Tone => TONES.get(value.trim().toLowerCase()) ?? "neutral";

/** The single-status fields shown as pills. Phase, stage and the like stay plain text. */
export const PILL_FIELDS: ReadonlySet<string> = new Set([
  "status", "initiative_status", "decision", "gate_status", "alignment_status", "align_why", "align_what", "align_how", "align_when",
  "outcome_status", "ci_status", "sync_state", "breakdown_status", "planning_status",
]);
