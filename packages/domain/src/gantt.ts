import { formatDate } from "./dates";
import { FIELDS, isShipped } from "./registry";

/**
 * Gantt view logic, with no UI in it: which items have a bar, the timeline scale, moving and resizing inside the
 * window, the keyboard steps, dropping an unscheduled item on the timeline, and the two-level grouping.
 * A bar runs from Planned Start (`planned_start`) to G2M Date (est) (`g2m_date_est`), as the dictionary says.
 */
const DAY_MS = 86_400_000;
const ISO = /^(\d{4})-(\d{2})-(\d{2})/;

/** Days since 1 Jan 1970 (UTC) of an ISO date; NaN when it is not one. */
export function toDay(iso: string): number {
  const m = ISO.exec(iso);
  if (!m) return NaN;
  const t = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!);
  const d = new Date(t);
  return d.getUTCMonth() === +m[2]! - 1 ? Math.round(t / DAY_MS) : NaN; // 31 Feb is not a date
}
export function fromDay(day: number): string {
  const d = new Date(day * DAY_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
const dayOf = (v: unknown) => (typeof v === "string" ? toDay(v) : NaN);
const todayDay = (d: Date) => Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY_MS);
const monthStart = (day: number) => { const d = new Date(day * DAY_MS); return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / DAY_MS); };
const nextMonthStart = (day: number) => { const d = new Date(day * DAY_MS); return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / DAY_MS); };

// ------------------------------------------------------------------ bars
export type Range = { startDay: number; endDay: number };
export type Bar = Range & { id: string; start: string; end: string };
export type GanttRow = { id: string; planned_start?: unknown; g2m_date_est?: unknown } & Record<string, unknown>;

/** Items with both dates (and the end not before the start) get a bar; the others go to the Unscheduled lane with the reason. */
export function classifyRows(rows: readonly GanttRow[]): { bars: Bar[]; unscheduled: { id: string; reason: string }[] } {
  const bars: Bar[] = [];
  const unscheduled: { id: string; reason: string }[] = [];
  for (const r of rows) {
    const s = dayOf(r.planned_start), e = dayOf(r.g2m_date_est);
    if (Number.isNaN(s) && Number.isNaN(e)) unscheduled.push({ id: r.id, reason: "No dates" });
    else if (Number.isNaN(s)) unscheduled.push({ id: r.id, reason: "No Planned Start" });
    else if (Number.isNaN(e)) unscheduled.push({ id: r.id, reason: "No G2M Date (est)" });
    else if (e < s) unscheduled.push({ id: r.id, reason: "G2M Date (est) is before Planned Start" });
    else bars.push({ id: r.id, start: fromDay(s), end: fromDay(e), startDay: s, endDay: e });
  }
  return { bars, unscheduled };
}

// ------------------------------------------------------------------ scale
export type Zoom = "month" | "quarter";
export const PX_PER_DAY: Record<Zoom, number> = { month: 6, quarter: 2 };
export type Window = Range;

export const dayToX = (day: number, win: Window, zoom: Zoom) => (day - win.startDay) * PX_PER_DAY[zoom];
export const xToDay = (x: number, win: Window, zoom: Zoom) => win.startDay + Math.round(x / PX_PER_DAY[zoom]);

/** Widen a window to whole months, and to at least `minDays`. */
export function clampWindow(win: Window, minDays: number): Window {
  const startDay = monthStart(win.startDay);
  let endDay = win.endDay === monthStart(win.endDay) ? win.endDay : nextMonthStart(win.endDay);
  while (endDay - startDay < minDays) endDay = nextMonthStart(endDay);
  return { startDay, endDay };
}

/** The visible timeline: the bars, today and some air around them, in whole months, at least nine months long. */
export function defaultWindow(bars: readonly Bar[], today: Date): Window {
  const t = todayDay(today);
  const first = bars.reduce((n, b) => Math.min(n, b.startDay), t - 30);
  const last = bars.reduce((n, b) => Math.max(n, b.endDay), t + 240);
  return clampWindow({ startDay: first, endDay: nextMonthStart(last) }, 270);
}

export type Tick = { label: string; x: number; width: number; startDay: number };
export function timelineTicks(win: Window, zoom: Zoom): Tick[] {
  const out: Tick[] = [];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let d = win.startDay;
  while (d < win.endDay) {
    const date = new Date(d * DAY_MS);
    const y = date.getUTCFullYear(), m = date.getUTCMonth();
    const next = zoom === "month" ? nextMonthStart(d) : Math.round(Date.UTC(y, (Math.floor(m / 3) + 1) * 3, 1) / DAY_MS);
    const end = Math.min(next, win.endDay);
    out.push({ label: zoom === "month" ? MONTHS[m]! : `Q${Math.floor(m / 3) + 1} ${y}`, x: dayToX(d, win, zoom), width: (end - d) * PX_PER_DAY[zoom], startDay: d });
    d = next;
  }
  return out;
}
/** Year headings above the month ticks. */
export function yearSpans(win: Window, zoom: Zoom): { label: string; x: number; width: number }[] {
  const out: { label: string; x: number; width: number }[] = [];
  let d = win.startDay;
  while (d < win.endDay) {
    const y = new Date(d * DAY_MS).getUTCFullYear();
    const next = Math.min(Math.round(Date.UTC(y + 1, 0, 1) / DAY_MS), win.endDay);
    out.push({ label: String(y), x: dayToX(d, win, zoom), width: (next - d) * PX_PER_DAY[zoom] });
    d = next;
  }
  return out;
}

// ------------------------------------------------------------------ moving
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Shift both dates; the bar keeps its length and stops at the window edge. */
export function moveRange(r: Range, delta: number, win: Window): Range {
  const len = r.endDay - r.startDay;
  if (len > win.endDay - win.startDay) return r;
  const startDay = clamp(r.startDay + delta, win.startDay, win.endDay - len);
  return { startDay, endDay: startDay + len };
}
/** Move one edge; a bar is at least one day (start = end) and stays inside the window. */
export function resizeRange(r: Range, edge: "start" | "end", delta: number, win: Window): Range {
  if (edge === "end") return { startDay: r.startDay, endDay: clamp(r.endDay + delta, r.startDay, Math.max(win.endDay, r.startDay)) };
  return { startDay: clamp(r.startDay + delta, Math.min(win.startDay, r.endDay), r.endDay), endDay: r.endDay };
}

/** Arrow keys: move by a day (Shift: a week); Alt changes the end date, Alt+Shift the start date, a day at a time. */
export function applyKey(r: Range, k: { key: string; shift: boolean; alt: boolean }, win: Window): Range | null {
  const dir = k.key === "ArrowRight" ? 1 : k.key === "ArrowLeft" ? -1 : 0;
  if (dir === 0) return null;
  if (k.alt) return resizeRange(r, k.shift ? "start" : "end", dir, win);
  return moveRange(r, dir * (k.shift ? 7 : 1), win);
}

/** "Planned Start 1 Mar to 8 Mar, G2M Date (est) 31 Mar to 7 Apr": the change shown while it is staged and after it is saved. */
export function summarizeChange(before: Range, after: Range, today: Date): string {
  const parts: string[] = [];
  if (before.startDay !== after.startDay) parts.push(`Planned Start ${formatDate(fromDay(before.startDay), today)} to ${formatDate(fromDay(after.startDay), today)}`);
  if (before.endDay !== after.endDay) parts.push(`G2M Date (est) ${formatDate(fromDay(before.endDay), today)} to ${formatDate(fromDay(after.endDay), today)}`);
  return parts.join(", ") || "No change";
}

export const DEFAULT_DURATION_DAYS = 28;
/** Drop an unscheduled item on a day: it starts there and lasts four weeks, unless it already has a later G2M date. */
export function scheduleAt(day: number, existing: { endDay?: number } | null, win: Window): Range {
  let startDay = day;
  let endDay = existing?.endDay !== undefined && existing.endDay > day ? existing.endDay : day + DEFAULT_DURATION_DAYS - 1;
  const len = endDay - startDay;
  if (endDay > win.endDay) { endDay = win.endDay; startDay = endDay - len; }
  if (startDay < win.startDay) { startDay = win.startDay; endDay = Math.min(win.endDay, startDay + len); }
  return { startDay, endDay };
}

// ------------------------------------------------------------------ grouping
export type GroupSpan = Range | null;
export type Line =
  | { kind: "group"; level: 1 | 2; id: string; field: string; key: string; label: string; count: number; collapsed: boolean; span: GroupSpan }
  | { kind: "item"; id: string; itemId: string; level: 0 | 1 | 2 | 3 };

export type LayoutOpts = {
  g1: string | null; g2: string | null;
  collapsed: ReadonlySet<string>;
  label: (field: string, value: unknown) => string;
  teamsOf: (row: GanttRow) => string[];
};

/** Group lines and item lines in drawing order. Only items with a bar are laid out; the others are in the Unscheduled lane. */
export function layoutLines(rows: readonly GanttRow[], bars: readonly Bar[], o: LayoutOpts): Line[] {
  const barOf = new Map(bars.map((b) => [b.id, b]));
  const items = rows.filter((r) => barOf.has(r.id));
  const valuesOf = (r: GanttRow, field: string): (string | null)[] => {
    if (field === "team") { const t = o.teamsOf(r); return t.length ? t : [null]; }
    const v = r[field];
    return [v === null || v === undefined || v === "" ? null : String(v)];
  };
  const span = (rs: GanttRow[]): GroupSpan => (rs.length ? { startDay: Math.min(...rs.map((r) => barOf.get(r.id)!.startDay)), endDay: Math.max(...rs.map((r) => barOf.get(r.id)!.endDay)) } : null);
  const out: Line[] = [];

  const emit = (rs: GanttRow[], levels: string[], parentId: string, level: 0 | 1 | 2 | 3) => {
    if (levels.length === 0) { for (const r of rs) out.push({ kind: "item", id: `${parentId}|${r.id}`, itemId: r.id, level }); return; }
    const field = levels[0]!;
    const groups = new Map<string, GanttRow[]>();
    for (const r of rs) for (const v of valuesOf(r, field)) { const k = v ?? ""; groups.set(k, [...(groups.get(k) ?? []), r]); }
    const named = [...groups.keys()].map((k) => ({ k, label: k === "" ? "No value" : o.label(field, k) }));
    named.sort((a, b) => (a.k === "" ? 1 : b.k === "" ? -1 : a.label.localeCompare(b.label, "en")));
    for (const { k, label } of named) {
      const members = groups.get(k)!;
      const id = `${parentId ? parentId + "/" : ""}${field}:${k}`;
      const collapsed = o.collapsed.has(id);
      out.push({ kind: "group", level: (level + 1) as 1 | 2, id, field, key: k, label, count: members.length, collapsed, span: span(members) });
      if (!collapsed) emit(members, levels.slice(1), id, (level + 1) as 1 | 2 | 3);
    }
  };
  emit(items, [o.g1, o.g2].filter((x): x is string => !!x), "", 0);
  return out;
}

export type GroupOption = { key: string; label: string };
/** What the chart can be grouped by: nothing, Initiative Group, project, team, and the other select fields people edit. */
export function ganttGroupOptions(): GroupOption[] {
  const selects = FIELDS.filter((f) => f.type === "Select" && f.editable && isShipped(f) && f.key !== "theme").map((f) => ({ key: f.key, label: f.name }));
  return [{ key: "", label: "No grouping" }, { key: "theme", label: "Initiative Group" }, { key: "home_project", label: "Project" }, { key: "team", label: "Team" }, ...selects];
}
