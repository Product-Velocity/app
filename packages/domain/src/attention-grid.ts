import { ATTENTION_KINDS, attentionLabel, type AttentionAction, type AttentionEntry, type AttentionKind, type AttentionReason } from "./attention";
import type { LeadRow } from "./leadership";
import { daysInPhase, dayNumber } from "./roadmap-health";

/**
 * Needs attention as a grid (docs/28-DECISION-GATES.md section 7a): one row per initiative, with the values a person filters and sorts by. Pure functions over
 * `attentionList` and the rows the Roadmap grid already holds. Everything here is about an initiative, never about a person's performance (CLAUDE.md rule 8);
 * the Product Manager column names who owns the initiative, nothing more.
 */
export type Urgency = "Urgent" | "Soon" | "Look at it";
export const URGENCIES: readonly Urgency[] = ["Urgent", "Soon", "Look at it"];
export const urgencyOf = (tier: 0 | 1 | 2): Urgency => URGENCIES[tier]!;

export type AttentionGridRow = {
  id: string; code: string; name: string; rank: number; tier: 0 | 1 | 2; urgency: Urgency;
  /** Reasons that are not snoozed, in order; the snoozed ones are kept separately so they can be shown and brought back. */
  reasons: AttentionReason[]; snoozedReasons: AttentionReason[];
  kinds: AttentionKind[]; reasonLabels: string; reasonText: string;
  phase: string; health: string; buildStatus: string; group: string; project: string; owner: string;
  daysInPhase: number | null; daysWaiting: number | null;
  /** The next step of each reason that has one (one per kind), the first is the main one. */
  actions: { kind: AttentionKind; action: AttentionAction }[];
  snoozed: boolean;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
export type GridContext = { today: Date; person?: (id: string) => string; project?: (id: string) => string };

export function attentionGridRows(entries: readonly AttentionEntry[], rows: readonly LeadRow[], ctx: GridContext): AttentionGridRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const todayNum = dayNumber(ctx.today);
  const out: AttentionGridRow[] = [];
  for (const e of entries) {
    const r = byId.get(e.id);
    if (!r) continue;
    const live = e.reasons.filter((x) => !x.snoozed);
    const shown = live.length > 0 ? live : e.reasons;
    const kinds = [...new Set(shown.map((x) => x.kind))];
    const waiting = live.filter((x) => x.kind === "gate-waiting" && typeof x.days === "number").map((x) => x.days!);
    const actions: AttentionGridRow["actions"] = [];
    for (const x of live) if (x.action && !actions.some((a) => a.kind === x.kind)) actions.push({ kind: x.kind, action: x.action });
    const pm = str(r.product_manager), proj = typeof r.home_project === "string" ? r.home_project : "";
    out.push({
      id: e.id, code: e.code, name: e.name, rank: e.rank, tier: e.tier, urgency: urgencyOf(e.tier),
      reasons: live, snoozedReasons: e.reasons.filter((x) => x.snoozed), kinds, reasonLabels: kinds.map(attentionLabel).join(", "),
      reasonText: shown.map((x) => x.text).join(" "),
      phase: str(r.initiative_phase), health: str(r.health), buildStatus: str(r.status), group: str(r.theme),
      project: proj && ctx.project ? ctx.project(proj) : proj, owner: pm && ctx.person ? ctx.person(pm) : "",
      daysInPhase: daysInPhase(r, todayNum), daysWaiting: waiting.length > 0 ? Math.max(...waiting) : null,
      actions, snoozed: e.snoozed,
    });
  }
  return out;
}

export type AttentionFilters = {
  /** Show these reasons only (empty: all). A row matches when any of its (not snoozed) reasons is one of them. */
  kinds?: readonly AttentionKind[]; urgencies?: readonly Urgency[]; phases?: readonly string[]; healths?: readonly string[]; groups?: readonly string[];
  /** Words that must all appear in the code, name, reasons, phase, group or owner. */
  search?: string;
  /** Rows whose reasons are all snoozed: hidden unless true. */
  showSnoozed?: boolean;
  /** Only rows that have a one-click next step. */
  actionable?: boolean;
};

const hay = (r: AttentionGridRow) => `${r.code} ${r.name} ${r.reasonLabels} ${r.reasonText} ${r.phase} ${r.group} ${r.owner} ${r.project} ${r.health}`.toLowerCase();

export function filterAttentionRows(rows: readonly AttentionGridRow[], f: AttentionFilters): AttentionGridRow[] {
  const words = (f.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) =>
    (f.showSnoozed || !r.snoozed)
    && (!f.kinds?.length || r.kinds.some((k) => f.kinds!.includes(k)))
    && (!f.urgencies?.length || f.urgencies.includes(r.urgency))
    && (!f.phases?.length || f.phases.includes(r.phase || "No phase"))
    && (!f.healths?.length || f.healths.includes(r.health || "No health"))
    && (!f.groups?.length || f.groups.includes(r.group || "No group"))
    && (!f.actionable || r.actions.length > 0)
    && words.every((w) => hay(r).includes(w)));
}

/** The values a filter can offer, with how many rows each has (of the rows given, so counts follow the other filters). */
export function facetCounts(rows: readonly AttentionGridRow[], pick: (r: AttentionGridRow) => string): { value: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) { const v = pick(r) || "None"; m.set(v, (m.get(v) ?? 0) + 1); }
  return [...m].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** Counts per reason for the quick filter chips: rows that match the other filters (not the reason filter itself). */
export function kindCounts(rows: readonly AttentionGridRow[]): Record<AttentionKind, number> {
  const c = Object.fromEntries(ATTENTION_KINDS.map((k) => [k.id, 0])) as Record<AttentionKind, number>;
  for (const r of rows) for (const k of r.kinds) c[k]++;
  return c;
}

const csvCell = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** A CSV of the rows as shown (what the person filtered), for a meeting or a message. No formulas: a cell that starts with = + - @ is prefixed so a spreadsheet does not run it. */
export function attentionCsv(rows: readonly AttentionGridRow[]): string {
  const safe = (v: unknown) => (typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : v);
  const head = ["Code", "Initiative", "Urgency", "Reasons", "What is wrong", "Phase", "Health", "Build status", "Initiative group", "Project", "Product manager", "Days in phase", "Days waiting", "Stack rank", "Snoozed"];
  const lines = rows.map((r) => [r.code, r.name, r.urgency, r.reasonLabels, r.reasonText, r.phase, r.health, r.buildStatus, r.group, r.project, r.owner, r.daysInPhase, r.daysWaiting, r.rank, r.snoozed ? "Yes" : ""].map(safe).map(csvCell).join(","));
  return [head.join(","), ...lines].join("\n");
}

/** What a bulk step does to a selection: who can be moved and who is skipped with the reason (the database still decides when it runs). */
export function bulkMoveSplit(rows: readonly AttentionGridRow[]): { movable: AttentionGridRow[]; skipped: { row: AttentionGridRow; reason: string }[] } {
  const movable: AttentionGridRow[] = [], skipped: { row: AttentionGridRow; reason: string }[] = [];
  for (const r of rows) {
    const a = r.actions.find((x) => x.action.type === "move");
    if (a) movable.push(r); else skipped.push({ row: r, reason: "no move to Test is suggested for it" });
  }
  return { movable, skipped };
}
