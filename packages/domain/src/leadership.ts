import { formatDate } from "./dates";
import { fromDay, toDay } from "./gantt";
import { FIELD_BY_KEY } from "./registry";

/**
 * The leadership view: portfolio health by project, what needs attention, the investment mix, what moved this week
 * (from the audit log) and a weekly update drafted from the data. Pure logic; people review and edit the draft and
 * nothing is sent anywhere.
 */
export type LeadRow = { id: string; item_code: string; initiative_name: string; stack_rank: number; home_project?: unknown } & Record<string, unknown>;

/**
 * The Leadership default view (sheet "Default views (ordered)", `docs/reference/default-views.csv`; a test compares them).
 * Issue #54 turns the grid's default views into data; until then this list is what the leadership page shows.
 */
export const LEADERSHIP_COLUMNS: readonly { key: string; pinned?: boolean }[] = [
  { key: "stack_rank", pinned: true }, { key: "item_code", pinned: true }, { key: "initiative_name", pinned: true },
  { key: "home_project" }, { key: "theme" }, { key: "roadmap_category" }, { key: "initiative_phase" }, { key: "health" },
  { key: "delivery_progress_pct" }, { key: "g2m_quarter" }, { key: "g2m_slip_days" }, { key: "value_12m" }, { key: "confidence" },
  { key: "decision" }, { key: "current_gate" }, { key: "fit_by_team" }, { key: "sponsor" }, { key: "next_review_date" }, { key: "summary" },
];

// ------------------------------------------------------------------ the week
export type WeekWindow = { start: string; end: string; number: number; range: string; label: string };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dmy = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return { y: y!, m: m!, d: d! }; };

/** The ISO week (Monday to Sunday) of a day; `end` is the Monday after (exclusive). */
export function weekWindow(today: Date): WeekWindow {
  const day = Math.round(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) / 86_400_000);
  const isodow = ((new Date(day * 86_400_000).getUTCDay() + 6) % 7) + 1; // Monday = 1
  const startDay = day - (isodow - 1);
  const thursday = startDay + 3;
  const ty = new Date(thursday * 86_400_000).getUTCFullYear();
  const jan4 = Math.round(Date.UTC(ty, 0, 4) / 86_400_000);
  const jan4Monday = jan4 - (((new Date(jan4 * 86_400_000).getUTCDay() + 6) % 7));
  const number = Math.floor((startDay - jan4Monday) / 7) + 1;
  const a = dmy(fromDay(startDay)), b = dmy(fromDay(startDay + 6));
  const range = a.y !== b.y ? `${a.d} ${MONTHS[a.m - 1]} ${a.y} to ${b.d} ${MONTHS[b.m - 1]} ${b.y}`
    : a.m !== b.m ? `${a.d} ${MONTHS[a.m - 1]} to ${b.d} ${MONTHS[b.m - 1]} ${b.y}` : `${a.d} to ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  return { start: fromDay(startDay), end: fromDay(startDay + 7), number, range, label: `Week ${number} · ${range}` };
}

// ------------------------------------------------------------------ health
export const HEALTH_STATES = ["On Track", "At Risk", "Delayed", "Blocked", "No health"] as const;
export type HealthState = (typeof HEALTH_STATES)[number];
export type HealthCounts = Record<HealthState, number>;
const WORST_FIRST: HealthState[] = ["Blocked", "Delayed", "At Risk", "On Track", "No health"];
const emptyCounts = (): HealthCounts => ({ "On Track": 0, "At Risk": 0, "Delayed": 0, "Blocked": 0, "No health": 0 });
const stateOf = (r: LeadRow): HealthState => (HEALTH_STATES as readonly string[]).includes(String(r.health)) && r.health !== "No health" ? (r.health as HealthState) : "No health";
const summarize = (c: HealthCounts) => WORST_FIRST.filter((s) => c[s] > 0).map((s) => `${c[s]} ${s}`).join(", ");

export type ProjectHealth = { id: string; name: string; total: number; counts: HealthCounts; summary: string };
/** Health of every project that has initiatives in the scope, with the words; projects A to Z. */
export function healthByProject(rows: readonly LeadRow[], projects: readonly { id: string; name: string }[]): { projects: ProjectHealth[]; totals: Omit<ProjectHealth, "id" | "name"> } {
  const by = new Map<string, HealthCounts>();
  const totals = emptyCounts();
  for (const r of rows) {
    const id = String(r.home_project ?? "");
    const c = by.get(id) ?? emptyCounts();
    const s = stateOf(r);
    c[s]++; totals[s]++;
    by.set(id, c);
  }
  const list = projects.filter((p) => by.has(p.id)).sort((a, b) => a.name.localeCompare(b.name, "en")).map((p) => {
    const counts = by.get(p.id)!;
    return { id: p.id, name: p.name, total: Object.values(counts).reduce((n, x) => n + x, 0), counts, summary: summarize(counts) };
  });
  return { projects: list, totals: { total: rows.length, counts: totals, summary: summarize(totals) } };
}

export const topItems = <T extends { stack_rank: number }>(rows: readonly T[], n: number): T[] => [...rows].sort((a, b) => a.stack_rank - b.stack_rank).slice(0, n);

// ------------------------------------------------------------------ attention
export type Attention = { id: string; code: string; name: string; health: string; reasons: string[]; tier: 0 | 1 | 2 };
const FINISHED_STATUS = new Set(["Completed", "Cancelled"]);
const FINISHED_PHASE = new Set(["Completed", "Sunset"]);
const isFinished = (r: LeadRow) => FINISHED_STATUS.has(String(r.status)) || FINISHED_PHASE.has(String(r.initiative_phase));

/** Blocked, Delayed or At Risk initiatives, ones past their G2M date and ones with blocked GitHub issues, worst first then by rank. */
export function needsAttention(rows: readonly LeadRow[], today: Date): Attention[] {
  const todayIso = fromDay(Math.round(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) / 86_400_000));
  const out: Attention[] = [];
  for (const r of rows) {
    const reasons: string[] = [];
    const health = String(r.health ?? "");
    if (["At Risk", "Delayed", "Blocked"].includes(health)) reasons.push(`Health is ${health}`);
    const blocked = typeof r.blocked_issues === "number" ? r.blocked_issues : 0;
    if (blocked > 0) reasons.push(`${blocked} blocked ${blocked === 1 ? "issue" : "issues"} on GitHub`);
    const g2m = typeof r.g2m_date_est === "string" && !Number.isNaN(toDay(r.g2m_date_est)) ? r.g2m_date_est : null;
    if (g2m && g2m < todayIso && !isFinished(r)) reasons.push(`G2M Date (est) ${formatDate(g2m, today)} has passed`);
    if (reasons.length === 0) continue;
    const tier = health === "Blocked" || blocked > 0 ? 0 : health === "Delayed" ? 1 : 2;
    out.push({ id: r.id, code: r.item_code, name: r.initiative_name, health, reasons, tier });
  }
  const rank = new Map(rows.map((r) => [r.id, r.stack_rank]));
  return out.sort((a, b) => a.tier - b.tier || rank.get(a.id)! - rank.get(b.id)!);
}

// ------------------------------------------------------------------ investment mix
export type MixRow = { label: string; count: number; pct: number };
/** Initiatives per Roadmap Category (the dictionary's five values in order, then "No category") with whole-number shares. */
export function categoryMix(rows: readonly LeadRow[]): MixRow[] {
  const values = FIELD_BY_KEY.roadmap_category?.allowed ?? [];
  const counts = new Map<string, number>(values.map((v) => [v, 0]));
  let none = 0;
  for (const r of rows) {
    const c = r.roadmap_category;
    if (typeof c === "string" && c !== "") counts.set(c, (counts.get(c) ?? 0) + 1); else none++;
  }
  const pct = (n: number) => (rows.length === 0 ? 0 : Math.round((n / rows.length) * 100));
  return [...[...counts].map(([label, count]) => ({ label, count, pct: pct(count) })), { label: "No category", count: none, pct: pct(none) }];
}

// ------------------------------------------------------------------ what moved
export type AuditChange = { itemId: string; field: string; old: unknown; new: unknown; at: string; actorId: string | null; via: string };
export type Move = { itemId: string; kind: "rank" | "status" | "health"; text: string; at: string };
const KINDS: Record<string, Move["kind"]> = { stack_rank: "rank", status: "status", health: "health" };

/** Rank, status and health changes of the week, from audit rows: a rank change is the net move; newest first. */
export function changesThisWeek(changes: readonly AuditChange[], rows: readonly LeadRow[]): Move[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const sorted = [...changes].filter((c) => byId.has(c.itemId) && KINDS[c.field]).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const out: Move[] = [];
  const ranks = new Map<string, AuditChange[]>();
  for (const c of sorted) {
    if (c.field === "stack_rank") { ranks.set(c.itemId, [...(ranks.get(c.itemId) ?? []), c]); continue; }
    const r = byId.get(c.itemId)!;
    const what = c.field;
    const text = c.old === null || c.old === undefined ? `${what} set to ${c.new}` : c.new === null || c.new === undefined ? `${what} cleared (was ${c.old})` : `${what} changed from ${c.old} to ${c.new}`;
    out.push({ itemId: c.itemId, kind: KINDS[c.field]!, text: `${r.item_code} ${r.initiative_name} ${text}`, at: c.at });
  }
  for (const [id, list] of ranks) {
    const from = Number(list[0]!.old), to = Number(list[list.length - 1]!.new);
    if (from === to || Number.isNaN(from) || Number.isNaN(to)) continue;
    const r = byId.get(id)!;
    const n = Math.abs(from - to);
    out.push({ itemId: id, kind: "rank", text: `${r.item_code} ${r.initiative_name} moved ${to < from ? "up" : "down"} ${n} ${n === 1 ? "place" : "places"} (#${from} to #${to})`, at: list[list.length - 1]!.at });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

// ------------------------------------------------------------------ the weekly update
export type UpdateInput = { rows: readonly LeadRow[]; projects: readonly { id: string; name: string }[]; scopeLabel: string; today: Date; changes: readonly Move[] };
export type UpdateDraft = { text: string; /** Ids of the initiatives the text talks about, for links. */ sources: string[] };
const LATE_STAGE = new Set(["Beta-test", "Experiment", "Roll-out"]);

/** A template-based draft of the weekly update from the data. A person edits and reviews it; Claude writes it in phase 4. */
export function draftWeeklyUpdate({ rows, scopeLabel, today, changes }: UpdateInput): UpdateDraft {
  const w = weekWindow(today);
  const sources = new Set<string>();
  const name = (r: LeadRow) => `${r.item_code} ${r.initiative_name}`;
  const section = (title: string, lines: string[]) => [``, title, ...lines];

  const completed = rows.filter((r) => typeof r.g2m_date_actual === "string" && r.g2m_date_actual >= w.start && r.g2m_date_actual < w.end);
  const todayIso = fromDay(Math.round(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) / 86_400_000));
  const highlights: string[] = [];
  for (const r of completed) { sources.add(r.id); highlights.push(`- ${name(r)} was completed on ${formatDate(String(r.g2m_date_actual), today)}.`); }
  if (completed.length === 0) highlights.push("- Nothing completed this week.");
  for (const r of [...rows].sort((a, b) => a.stack_rank - b.stack_rank).filter((x) => LATE_STAGE.has(String(x.initiative_phase)) && !isFinished(x)).slice(0, 5)) {
    sources.add(r.id);
    highlights.push(`- ${name(r)} is in ${String(r.initiative_phase).toLowerCase()}.${typeof r.g2m_date_est === "string" ? ` G2M is ${formatDate(r.g2m_date_est, today)}.` : ""}`);
  }

  const attention = needsAttention(rows, today);
  const risks: string[] = [];
  for (const a of attention.slice(0, 8)) {
    sources.add(a.id);
    const [first, ...rest] = a.reasons;
    const lead = first!.startsWith("Health is ") ? `${a.code} ${a.name} is ${first!.slice("Health is ".length).toLowerCase()}.` : `${a.code} ${a.name}: ${first}.`;
    risks.push(`- ${[lead, ...rest.map((x) => `${x}.`)].join(" ")}`);
  }
  if (attention.length === 0) risks.push("- Nothing needs attention.");
  risks.push("Ask: ");

  const moved: string[] = [];
  for (const m of changes.slice(0, 8)) { sources.add(m.itemId); moved.push(`- ${m.text}`); }
  if (changes.length === 0) moved.push("- No rank, status or health changes this week.");

  const horizon = fromDay(toDay(todayIso) + 14);
  const due = rows.filter((r) => typeof r.g2m_date_est === "string" && r.g2m_date_est >= todayIso && r.g2m_date_est <= horizon && !isFinished(r)).sort((a, b) => String(a.g2m_date_est).localeCompare(String(b.g2m_date_est)));
  const next: string[] = [];
  for (const r of due) { sources.add(r.id); next.push(`- ${r.item_code} goes live ${formatDate(String(r.g2m_date_est), today)}.`); }
  if (due.length === 0) next.push("- Nothing is due in the next two weeks.");

  const mix = categoryMix(rows).filter((m) => m.count > 0).map((m) => `- ${m.label}: ${m.count} (${m.pct}%)`);
  const text = [
    `${scopeLabel}, week ${w.number} (${w.range})`,
    ...section("Highlights", highlights), ...section("Risks and asks", risks), ...section("What moved this week", moved),
    ...section("Next two weeks", next), ...section("Investment mix", mix.length ? mix : ["- No initiatives in this scope."]),
  ].join("\n");
  return { text, sources: [...sources] };
}
