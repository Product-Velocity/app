import { needsAttention, type LeadRow } from "./leadership";
import { daysInPhase, dayNumber } from "./roadmap-health";
import { gateOfPhase, isOpen, phaseSuggestions, type GateId, type GateRequest, type Phase } from "./gates";

/**
 * Needs attention (issue #337, docs/28-DECISION-GATES.md section 7a; decision 2026-11-05-needs-attention.md). What a person should look at, why, and the next step.
 * Pure rules over the rows the grid already holds plus the gate requests and open conditions. Everything here is about an initiative or a team, never about
 * a person's performance (CLAUDE.md rule 8), and a mismatch is a suggestion, never an automatic change (decision 2026-10-28, item 6).
 */
export type AttentionKind = "delivery-risk" | "build-done" | "tracker-early" | "cancelled-building" | "hold-due" | "gate-waiting" | "conditions" | "stalled";

export const ATTENTION_KINDS: readonly { id: AttentionKind; label: string; hint: string }[] = [
  { id: "delivery-risk", label: "Delivery risk", hint: "Health is Blocked, At Risk or Delayed, the G2M date has passed, or issues are blocked." },
  { id: "build-done", label: "Build done", hint: "The tracker says the build is done while the phase is still Build." },
  { id: "tracker-early", label: "Work before the gate", hint: "Tracker work started before the gate that approves it." },
  { id: "cancelled-building", label: "Cancelled but building", hint: "Initiative Status is Cancelled while the build is in progress." },
  { id: "hold-due", label: "Hold due", hint: "The review date of a Hold has come." },
  { id: "gate-waiting", label: "Waiting for a decision", hint: "A gate request has waited more than a week." },
  { id: "conditions", label: "Open conditions", hint: "A Go with conditions left tasks that are not done." },
  { id: "stalled", label: "Stalled in a phase", hint: "Active, and in the same phase for longer than the usual limit." },
];
export const attentionLabel = (k: AttentionKind) => ATTENTION_KINDS.find((x) => x.id === k)?.label ?? k;

/** Days an Active initiative may stay in a phase before it shows as stalled. A default; Roadmap Health shows the real distribution. */
export const STALL_DAYS: Readonly<Record<string, number>> = { Discover: 30, Define: 30, Build: 90, Test: 30, Experiment: 45, "Roll-out": 60 };
/** A gate request waits this long before it shows as waiting. */
export const GATE_WAIT_DAYS = 7;

export type AttentionAction =
  | { type: "move"; to: Phase; label: string }
  | { type: "request-gate"; gate: GateId; label: string }
  | { type: "decisions"; label: string };
export type AttentionReason = { kind: AttentionKind; text: string; days?: number; action?: AttentionAction };
export type AttentionEntry = { id: string; code: string; name: string; rank: number; tier: 0 | 1 | 2; reasons: AttentionReason[] };
export type OpenCondition = { item_id: string; text: string };

const finished = (r: LeadRow) => r.initiative_status === "Completed" || r.initiative_status === "Cancelled" || r.initiative_phase === "Completed";
const dayOf = (iso: string) => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000);

export function attentionList(rows: readonly LeadRow[], today: Date, ctx: { requests?: readonly GateRequest[]; conditions?: readonly OpenCondition[] } = {}): AttentionEntry[] {
  const todayNum = dayNumber(today);
  const todayIso = new Date(todayNum * 86_400_000).toISOString().slice(0, 10);
  const byItem = new Map<string, AttentionReason[]>();
  const add = (id: string, r: AttentionReason) => byItem.set(id, [...(byItem.get(id) ?? []), r]);
  const ids = new Set(rows.map((r) => r.id));

  for (const a of needsAttention(rows, today)) for (const text of a.reasons) add(a.id, { kind: "delivery-risk", text });

  for (const r of rows) {
    const phase = typeof r.initiative_phase === "string" ? r.initiative_phase : null;
    const build = r.status;
    if (r.initiative_status === "Cancelled") {
      if (build === "In progress") add(r.id, { kind: "cancelled-building", text: "Initiative Status is Cancelled but the build is still in progress in the tracker. Stop the work there, or set the status back." });
      continue;
    }
    if (finished(r)) continue;
    for (const s of phaseSuggestions(r, todayIso)) {
      if (s.kind === "build-done") add(r.id, { kind: "build-done", text: "The build is done in the tracker. Move to Test?", action: { type: "move", to: "Test", label: "Move to Test" } });
      else add(r.id, { kind: "hold-due", text: "The date to look at this Hold again has come.", action: { type: "request-gate", gate: gateOfPhase(phase) ?? "B", label: "Request the gate again" } });
    }
    if ((phase === "Discover" || phase === "Define") && (build === "In progress" || build === "Done")) {
      const gate = gateOfPhase(phase)!;
      add(r.id, { kind: "tracker-early", text: `Work started in the tracker while the phase is ${phase}, before gate ${gate === "A" ? "B" : gate}.`, action: { type: "request-gate", gate, label: `Request gate ${gate}` } });
    }
    if (r.initiative_status === "Active" && phase && STALL_DAYS[phase] !== undefined && r.gate_status !== "Held") {
      const d = daysInPhase(r, todayNum);
      if (d !== null && d > STALL_DAYS[phase]!) add(r.id, { kind: "stalled", text: `${d} days in ${phase} (usually at most ${STALL_DAYS[phase]}).`, days: d });
    }
  }

  for (const q of ctx.requests ?? []) {
    if (!isOpen(q) || !ids.has(q.item_id)) continue;
    const days = todayNum - dayOf(q.requested_at);
    if (days > GATE_WAIT_DAYS) add(q.item_id, { kind: "gate-waiting", text: `Gate ${q.gate} has waited ${days} days for a decision.`, days, action: { type: "decisions", label: "Open Decisions" } });
  }
  const open = new Map<string, string[]>();
  for (const c of ctx.conditions ?? []) if (ids.has(c.item_id)) open.set(c.item_id, [...(open.get(c.item_id) ?? []), c.text]);
  for (const [id, texts] of open) add(id, { kind: "conditions", text: `${texts.length} open ${texts.length === 1 ? "condition" : "conditions"}: ${texts.slice(0, 2).join("; ")}${texts.length > 2 ? "; …" : ""}` });

  const out: AttentionEntry[] = [];
  for (const r of rows) {
    const reasons = byItem.get(r.id);
    if (!reasons || reasons.length === 0) continue;
    const blocked = r.health === "Blocked" || (typeof r.blocked_issues === "number" && r.blocked_issues > 0);
    const tier: 0 | 1 | 2 = blocked || reasons.some((x) => x.kind === "cancelled-building") ? 0 : reasons.some((x) => x.kind === "gate-waiting" || x.kind === "delivery-risk" && r.health === "Delayed") ? 1 : 2;
    out.push({ id: r.id, code: r.item_code, name: r.initiative_name, rank: r.stack_rank, tier, reasons });
  }
  return out.sort((a, b) => a.tier - b.tier || a.rank - b.rank);
}

/** How many entries each kind has (an entry with two reasons of one kind counts once), for the filter chips. */
export function attentionCounts(entries: readonly AttentionEntry[]): Record<AttentionKind, number> {
  const c = Object.fromEntries(ATTENTION_KINDS.map((k) => [k.id, 0])) as Record<AttentionKind, number>;
  for (const e of entries) for (const k of new Set(e.reasons.map((r) => r.kind))) c[k]++;
  return c;
}
export const filterAttention = (entries: readonly AttentionEntry[], kind: AttentionKind | "all"): AttentionEntry[] =>
  kind === "all" ? [...entries] : entries.filter((e) => e.reasons.some((r) => r.kind === kind));
