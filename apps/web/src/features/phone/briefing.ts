import { flagsOfRow } from "@pv/domain";

/**
 * The read-first page of one initiative on a phone (issue #635, slice P4): what a person asks in the minute before a meeting, in words. Pure rules over the
 * roadmap row. Nothing commercial is shown (value, confidence, customers stay in the full panel under their role rules, CLAUDE.md rule 2), and nothing is
 * counted per person (rule 8).
 */
export type BriefingRow = Record<string, unknown> & { id: string; item_code: string; initiative_name: string; stack_rank: number; home_project: string };
export type Fact = { label: string; value: string };

const text = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());
const dateWords = (v: unknown): string => {
  const s = text(v).slice(0, 10);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
};

/** The facts people ask for first, in a fixed order; a fact with nothing to say is left out, except the owner and the planned quarter, which say "Not set". */
export function briefingFacts(row: BriefingRow, ctx: { person: (id: string) => string }): Fact[] {
  const facts: Fact[] = [];
  const add = (label: string, value: string, always = false) => { if (value || always) facts.push({ label, value: value || "Not set" }); };
  add("Phase", text(row.initiative_phase));
  add("Status", text(row.initiative_status));
  add("Owner", ctx.person(text(row.product_manager)) || text(row.product_manager), true);
  add("Engineering", ctx.person(text(row.engineering_manager)) || text(row.engineering_manager));
  add("Planned quarter", text(row.g2m_quarter), true);
  add("G2M date", dateWords(row.g2m_date_est));
  add("Days in phase", typeof row.days_in_phase === "number" ? String(row.days_in_phase) : "");
  return facts;
}

/** "Gate B, In review" or "No gate open". */
export function gateLine(row: BriefingRow): string {
  const gate = text(row.current_gate), status = text(row.gate_status);
  if (!gate && (!status || status === "Not started")) return "No gate open";
  return [gate ? `Gate ${gate.replace(/^Gate\s*/i, "")}` : "", status].filter(Boolean).join(", ");
}

/** The build line: the tracker's progress, and the words around it. Progress is the tracker's, never typed (rule 6). */
export function buildLine(row: BriefingRow): { pct: number | null; text: string } | null {
  const pct = typeof row.delivery_progress_pct === "number" ? Math.max(0, Math.min(100, Math.round(row.delivery_progress_pct))) : null;
  const status = text(row.status), tracker = text(row.tracker_status);
  if (pct === null && !status && !tracker) return null;
  return { pct, text: [status ? `Build ${status}` : "", pct !== null ? `${pct}% built` : "", tracker && tracker !== status ? `tracker: ${tracker}` : ""].filter(Boolean).join(" · ") };
}

const CLAMP = 280;
/** The hypothesis and the description, trimmed for a first look; `more` is true when there is text beyond the first screen. */
export function briefingText(row: BriefingRow): { hypothesis: string; description: string; short: string; more: boolean } {
  const hypothesis = text(row.hypothesis), description = text(row.description);
  const first = description || hypothesis;
  return { hypothesis, description, short: first.length > CLAMP ? `${first.slice(0, CLAMP).trimEnd()}…` : first, more: first.length > CLAMP || (!!description && !!hypothesis) };
}

/** What needs attention, in the app's own words (the same rules as the flags in the panel and the grid). Read-only here. */
export function briefingFlags(row: BriefingRow, today: Date): { label: string; text: string }[] {
  return flagsOfRow(row, today).map((f) => ({ label: f.label, text: f.text }));
}
