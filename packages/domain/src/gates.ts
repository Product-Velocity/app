/**
 * Decision gates A, B and C and the moves between phases (issue #323, docs/28-DECISION-GATES.md).
 * Pure rules shared by the grid, the item panel, the Decisions screen and the tools. The database enforces the same rules
 * (functions request_gate, decide_gate, move_phase); this file is what the screens use to offer only what can work and to explain why not.
 */

export const PHASES = ["Discover", "Define", "Build", "Test", "Experiment", "Roll-out", "Completed"] as const;
export type Phase = (typeof PHASES)[number];
export type GateId = "A" | "B" | "C";
export const GATE_IDS: readonly GateId[] = ["A", "B", "C"];
export type GateOutcome = "go" | "go_with_conditions" | "hold" | "stop";

export const OUTCOMES: readonly { value: GateOutcome; label: string; hint: string; key: string }[] = [
  { value: "go", label: "Go", hint: "Move on. The phase changes.", key: "g" },
  { value: "go_with_conditions", label: "Go with conditions", hint: "Move on; each condition becomes a task that is tracked until it is done.", key: "c" },
  { value: "hold", label: "Hold", hint: "Stay in the phase and come back.", key: "h" },
  { value: "stop", label: "Stop", hint: "Do not continue. The initiative is set to Cancelled.", key: "s" },
];
export const outcomeLabel = (o: string | null | undefined) => OUTCOMES.find((x) => x.value === o)?.label ?? "Open";

/** What a gate asks, the phase it is passed from and the phase it opens. */
export const GATES: Record<GateId, { id: GateId; from: Phase; to: Phase; question: string; approves: string }> = {
  A: { id: "A", from: "Discover", to: "Define", question: "Is this worth defining; is the discovery solid?", approves: "the discovery document" },
  B: { id: "B", from: "Define", to: "Build", question: "Do we commit to build it?", approves: "the PRD" },
  C: { id: "C", from: "Experiment", to: "Roll-out", question: "Did the experiment pass; may it roll out?", approves: "nothing (the phase moves)" },
};
export const gateTitle = (g: GateId) => `Gate ${g}: ${GATES[g].from} to ${GATES[g].to}`;

export const phaseIndex = (p: unknown): number => {
  const i = PHASES.indexOf(p as Phase);
  return i < 0 ? 0 : i; // an item without a phase is treated as Discover
};

/** The gate an item in this phase has to pass next, or null (Build, Test, Roll-out, Completed). */
export function gateOfPhase(phase: unknown): GateId | null {
  const p = typeof phase === "string" ? phase : "Discover";
  return GATE_IDS.find((g) => GATES[g].from === p) ?? null;
}

/** Gates that can still be requested for an item at this phase: its own and the later ones (asking for a later one is a fast-lane jump). */
export function requestableGates(phase: unknown): GateId[] {
  const at = phaseIndex(phase);
  return GATE_IDS.filter((g) => at <= phaseIndex(GATES[g].from));
}

/** The phases a move without a gate can go to: any earlier phase, and later ones up to (not across) the next gate. Completed is set through Initiative Status. */
export function movablePhases(phase: unknown): Phase[] {
  const at = phaseIndex(phase);
  if (phase === "Completed") return [];
  const next = GATE_IDS.map((g) => phaseIndex(GATES[g].from)).filter((i) => i >= at).sort((a, b) => a - b)[0];
  return PHASES.filter((p, i) => p !== "Completed" && i !== at && (i < at || next === undefined || i <= next));
}

/** Why a forward move to `to` needs a gate instead, or null when it does not. */
export function moveNeedsGate(from: unknown, to: Phase): GateId | null {
  const a = phaseIndex(from);
  const b = phaseIndex(to);
  if (b <= a) return null;
  return GATE_IDS.find((g) => phaseIndex(GATES[g].from) >= a && phaseIndex(GATES[g].from) < b) ?? null;
}

/** The phases the approver can choose as the target of a Go at this gate for an item at `from`: the default first, then later ones up to Roll-out (fast lane). */
export function targetPhases(gate: GateId, from?: unknown): { phase: Phase; fastLane: boolean }[] {
  const def = phaseIndex(GATES[gate].to);
  const at = phaseIndex(from);
  return PHASES.slice(def, PHASES.indexOf("Roll-out") + 1).map((phase) => ({ phase, fastLane: phase !== GATES[gate].to || at < phaseIndex(GATES[gate].from) }));
}

export type ChecklistItem = { label: string; ok: boolean };
type Doc = { kind: string; status: string };
const filled = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";

/** What the requester and the approver see as the checklist for a gate. It informs; it never blocks a decision (docs/28 section 3). */
export function gateChecklist(gate: GateId, row: Record<string, unknown>, docs: readonly Doc[] = []): ChecklistItem[] {
  const has = (kind: string) => docs.some((d) => d.kind === kind);
  const list: ChecklistItem[] = [
    { label: "Initiative has a name and a project", ok: filled(row.initiative_name) && filled(row.home_project) },
    { label: "Hypothesis written", ok: filled(row.hypothesis) },
  ];
  if (gate === "A") list.push({ label: "Discovery document exists", ok: has("discovery") }, { label: "Primary key result named", ok: filled(row.kr_metric) });
  if (gate === "B") {
    list.push(
      { label: "PRD document exists", ok: has("prd") },
      { label: "Effort estimated", ok: filled(row.effort) },
      { label: "MoSCoW set", ok: filled(row.moscow) },
      { label: "Not blocked", ok: row.health !== "Blocked" },
    );
  }
  if (gate === "C") list.push({ label: "Experiment started", ok: filled(row.start_experiment) }, { label: "Not blocked", ok: row.health !== "Blocked" });
  return list;
}
export const checklistReady = (list: readonly ChecklistItem[]) => list.every((c) => c.ok);

/** The gate request states shown on the Decisions screen. */
export type GateRequest = {
  id: string; item_id: string; gate: GateId; kind: "decision" | "skipped"; requested_by: string | null; requested_at: string;
  preferred_approvers: string[]; ready: boolean; criteria: ChecklistItem[]; outcome: GateOutcome | null; rationale: string | null;
  fast_lane: boolean; target_phase: string | null; skipped_phases: string[]; review_date: string | null;
  decided_by: string | null; decided_at: string | null; withdrawn_at: string | null;
};
export type QueueFilter = "waiting" | "decided" | "mine" | "can-decide";
export const QUEUE_FILTERS: readonly { id: QueueFilter; label: string }[] = [
  { id: "waiting", label: "Waiting for approval" }, { id: "decided", label: "Decided" }, { id: "mine", label: "Requested by me" }, { id: "can-decide", label: "Can decide" },
];
export const isOpen = (r: GateRequest) => r.kind === "decision" && !r.decided_at && !r.withdrawn_at;

/** Rows for a filter, newest request first (decided: newest decision first). `can` lists the gates this person may decide. */
export function filterQueue(rows: readonly GateRequest[], filter: QueueFilter, me: string | null, can: readonly GateId[]): GateRequest[] {
  const keep = (r: GateRequest) =>
    filter === "waiting" ? isOpen(r)
    : filter === "decided" ? r.kind === "decision" && Boolean(r.decided_at)
    : filter === "mine" ? r.kind === "decision" && !r.withdrawn_at && r.requested_by === me
    : isOpen(r) && can.includes(r.gate);
  const when = (r: GateRequest) => (filter === "decided" ? r.decided_at ?? r.requested_at : r.requested_at);
  return rows.filter(keep).sort((a, b) => when(b).localeCompare(when(a)));
}
/** Open requests this person could decide: the number on the Decisions tab. */
export const decidableCount = (rows: readonly GateRequest[], can: readonly GateId[]) => rows.filter((r) => isOpen(r) && can.includes(r.gate)).length;

export type BulkOutcome = { id: string; ok: boolean; message?: string };
/** Splits a selection for a bulk gate request: the items at the phase the gate is passed from (or earlier), and the others with the reason. */
export function splitForRequest<T extends { id: string; initiative_phase?: unknown; item_code?: unknown }>(items: readonly T[], gate: GateId): { ready: T[]; skipped: { item: T; reason: string }[] } {
  const ready: T[] = [];
  const skipped: { item: T; reason: string }[] = [];
  for (const it of items) {
    if (phaseIndex(it.initiative_phase) > phaseIndex(GATES[gate].from)) skipped.push({ item: it, reason: `already past gate ${gate} (${String(it.initiative_phase)})` });
    else ready.push(it);
  }
  return { ready, skipped };
}

/** Plain words for the errors the database raises on a gate action. */
export function gateErrorText(code: string | undefined, message: string | undefined): string {
  if (code === "PV006") return message && /already closed|already open|already past|passes a decision gate|cannot be/.test(message) ? message : "Someone else already handled this request.";
  if (code === "PV004") return "Claude and service accounts cannot request, decide or move a gate; a person does.";
  if (code === "42501") return message && /approval rights|Admin|Creator/.test(message) ? message : "You do not have permission to do this.";
  return message || "Something went wrong.";
}

export type PhaseSuggestion = { kind: "build-done" | "hold-due"; text: string; moveTo?: Phase };
/**
 * Suggestions, never automatic changes (decision 2026-11-05): the tracker says the build is done while the phase is still Build, or a Hold's review date has passed.
 * One click accepts the first; the person is the actor in the audit log.
 */
export function phaseSuggestions(row: Record<string, unknown>, today: string): PhaseSuggestion[] {
  const out: PhaseSuggestion[] = [];
  if (row.initiative_phase === "Build" && row.status === "Done" && row.initiative_status !== "Cancelled") {
    out.push({ kind: "build-done", text: "The build is done in the tracker. Move to Test?", moveTo: "Test" });
  }
  if (row.gate_status === "Held" && typeof row.next_gate_due === "string" && row.next_gate_due !== "" && row.next_gate_due <= today) {
    out.push({ kind: "hold-due", text: "The date to look at this Hold again has passed. Request the gate again?" });
  }
  return out;
}
