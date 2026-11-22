import { GATES, checklistReady, gateChecklist, gateTitle, isOpen, outcomeLabel, type ChecklistItem, type GateId, type GateOutcome, type GateRequest } from "./gates";
import { GATE_WAIT_DAYS } from "./attention";
import { dayNumber } from "./roadmap-health";

/**
 * The Decisions screen as a grid (docs/28-DECISION-GATES.md section 6): one row per gate request with the values a person filters and sorts by. Pure functions.
 * It says how long a request has waited, never how slow a person is (CLAUDE.md rule 8): there is no column or sort by approver.
 */
export type DecisionState = "Waiting" | "Decided" | "Withdrawn";
export type DecisionGridRow = {
  id: string; itemId: string; code: string; name: string; gate: GateId; gateLabel: string; state: DecisionState;
  requestedBy: string; requestedAt: string; decidedBy: string; decidedAt: string | null; outcome: GateOutcome | null; outcomeLabel: string; fastLane: boolean; rationale: string;
  daysWaiting: number | null; overdue: boolean;
  checklist: ChecklistItem[]; checklistDone: number; checklistTotal: number; checklistComplete: boolean;
  /** Whether the checklist is the one recorded with the request (true) or worked out now from the initiative (false). */
  checklistRecorded: boolean;
  hypothesis: string; phase: string; health: string; group: string;
  canDecide: boolean; mine: boolean;
};
export type DecisionContext = {
  today: Date; me: string | null; can: readonly GateId[];
  item: (id: string) => Record<string, unknown> | undefined; docs: (id: string) => readonly { kind: string; status: string }[];
  email: (id: string | null) => string;
};
const s = (v: unknown) => (typeof v === "string" ? v : "");
const dayOf = (iso: string) => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000);

export function decisionGridRows(requests: readonly GateRequest[], ctx: DecisionContext): DecisionGridRow[] {
  const today = dayNumber(ctx.today);
  return requests.filter((r) => r.kind === "decision").map((r): DecisionGridRow => {
    const it = ctx.item(r.item_id);
    const recorded = r.criteria.length > 0;
    const checklist = recorded ? r.criteria : it ? gateChecklist(r.gate, it, ctx.docs(r.item_id)) : [];
    const open = isOpen(r);
    const waiting = open ? Math.max(0, today - dayOf(r.requested_at)) : null;
    return {
      id: r.id, itemId: r.item_id, code: s(it?.item_code) || "", name: s(it?.initiative_name) || r.item_id, gate: r.gate, gateLabel: gateTitle(r.gate),
      state: open ? "Waiting" : r.decided_at ? "Decided" : "Withdrawn",
      requestedBy: ctx.email(r.requested_by), requestedAt: r.requested_at, decidedBy: r.decided_by ? ctx.email(r.decided_by) : "", decidedAt: r.decided_at,
      outcome: r.outcome, outcomeLabel: r.decided_at ? outcomeLabel(r.outcome) : "", fastLane: r.fast_lane, rationale: r.rationale ?? "",
      daysWaiting: waiting, overdue: waiting !== null && waiting > GATE_WAIT_DAYS,
      checklist, checklistDone: checklist.filter((c) => c.ok).length, checklistTotal: checklist.length, checklistComplete: checklist.length > 0 && checklistReady(checklist), checklistRecorded: recorded,
      hypothesis: s(it?.hypothesis), phase: s(it?.initiative_phase), health: s(it?.health), group: s(it?.theme),
      canDecide: open && ctx.can.includes(r.gate), mine: ctx.me !== null && r.requested_by === ctx.me,
    };
  });
}

export type DecisionFilters = {
  gates?: readonly GateId[]; outcomes?: readonly GateOutcome[];
  /** Only requests waiting longer than the usual week. */
  overdue?: boolean; incomplete?: boolean; canDecide?: boolean; mine?: boolean;
  search?: string;
};
const hay = (r: DecisionGridRow) => `${r.code} ${r.name} ${r.gateLabel} ${r.requestedBy} ${r.decidedBy} ${r.outcomeLabel} ${r.hypothesis} ${r.rationale} ${r.phase} ${r.group}`.toLowerCase();
export function filterDecisionRows(rows: readonly DecisionGridRow[], f: DecisionFilters): DecisionGridRow[] {
  const words = (f.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) =>
    (!f.gates?.length || f.gates.includes(r.gate))
    && (!f.outcomes?.length || (r.outcome !== null && f.outcomes.includes(r.outcome)))
    && (!f.overdue || r.overdue) && (!f.incomplete || (r.state === "Waiting" && !r.checklistComplete)) && (!f.canDecide || r.canDecide) && (!f.mine || r.mine)
    && words.every((w) => hay(r).includes(w)));
}

/** What a bulk decision on a selection needs the approver to know: how many have an incomplete checklist, how many cannot be decided by this person. */
export function bulkDecisionSummary(rows: readonly DecisionGridRow[]) {
  const decidable = rows.filter((r) => r.canDecide);
  return {
    total: rows.length, decidable: decidable.length, notDecidable: rows.length - decidable.length,
    incomplete: decidable.filter((r) => !r.checklistComplete).length,
    gates: [...new Set(decidable.map((r) => r.gate))].sort() as GateId[],
    question: (g: GateId) => GATES[g].question,
  };
}

const csvCell = (v: unknown) => { const t = v === null || v === undefined ? "" : String(v); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
export function decisionsCsv(rows: readonly DecisionGridRow[]): string {
  const safe = (v: unknown) => (typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : v);
  const head = ["Code", "Initiative", "Gate", "State", "Requested by", "Requested", "Days waiting", "Checklist", "Outcome", "Decided by", "Decided"];
  return [head.join(","), ...rows.map((r) => [r.code, r.name, r.gateLabel, r.state, r.requestedBy, r.requestedAt.slice(0, 10), r.daysWaiting, `${r.checklistDone}/${r.checklistTotal}`, r.outcomeLabel, r.decidedBy, r.decidedAt?.slice(0, 10)].map(safe).map(csvCell).join(","))].join("\n");
}
