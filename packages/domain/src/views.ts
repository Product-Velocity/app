import { compareQuarters, isQuarter } from "./quarters";
import { formatDate, localToday } from "./dates";
import { FIELDS, HIDDEN_FIELDS, FIELD_BY_KEY, isOpenList, type FieldDef } from "./registry";

/** The columns every view shows and keeps on the left, so a row always says which initiative it is. */
export const CORE_COLUMN_KEYS = ["stack_rank", "item_code", "initiative_name"] as const;

// ------------------------------------------------------------------ filters
export type FilterOp = "is" | "is_not" | "any_of" | "contains" | "gt" | "lt" | "before" | "after" | "between" | "in_last" | "in_next" | "today" | "this_week" | "this_month" | "empty" | "not_empty";
/**
 * `value2` is the second date of "between". For "in the last / next" the value is a number of days. "is any of" holds its choices in `values`.
 * "today", "this week" and "this month" are read against the day it is today, so a saved view never goes stale.
 */
export type Filter = { field: string; op: FilterOp; value?: string; value2?: string; values?: string[] };

const OP_LABEL: Record<FilterOp, string> = {
  is: "is", is_not: "is not", any_of: "is any of", contains: "contains", gt: "is greater than", lt: "is less than",
  before: "is before", after: "is after", between: "is between", in_last: "is in the last (days)", in_next: "is in the next (days)", today: "is today", this_week: "is this week", this_month: "is this month", empty: "is empty", not_empty: "is not empty",
};
const OPS = Object.keys(OP_LABEL) as FilterOp[];
const NUMERIC = new Set(["Number", "Currency", "Computed"]);
/** Dates the app keeps itself (when it was made, last changed, status last changed) filter like date fields; they are stored with a time. */
const DATE_SYSTEM_KEYS = new Set(["created_at", "last_edited_at", "status_changed_at"]);
export const isDateField = (f: FieldDef) => f.type === "Date" || DATE_SYSTEM_KEYS.has(f.key);
const TEXTUAL = new Set(["Text", "Long text", "Person or text"]);
const op = (o: FilterOp) => ({ op: o, label: OP_LABEL[o] });

/** The operators that make sense for a field, in the order they are offered. */
export function opsFor(f: FieldDef): { op: FilterOp; label: string }[] {
  if (f.type === "Boolean") return [op("is")];
  if (isDateField(f)) return (["before", "after", "between", "is", "today", "this_week", "this_month", "in_last", "in_next", "empty", "not_empty"] as const).map(op);
  if (NUMERIC.has(f.type)) return (["gt", "lt", "is", "empty", "not_empty"] as const).map(op);
  if (TEXTUAL.has(f.type)) return (["contains", "is", "empty", "not_empty"] as const).map(op);
  if (f.type === "Select" || f.type === "Person" || f.key === "home_project") return (["is", "any_of", "is_not", "empty", "not_empty"] as const).map(op);
  return (["contains", "empty", "not_empty"] as const).map(op); // tags, links and other values shown as text
}

const ISO = /^\d{4}-\d\d-\d\d$/;
type Row = Record<string, unknown>;
export type FilterCtx = { me?: string | null; today?: Date };
const blank = (v: unknown) => v === null || v === undefined || v === "";
/** The calendar day (yyyy-mm-dd) of a date or of a timestamp such as 2026-10-23T14:02:11Z, in the person's own time zone. */
function dayOf(v: unknown): unknown {
  if (typeof v !== "string" || !/^\d{4}-\d\d-\d\dT/.test(v)) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v.slice(0, 10) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isMatch(def: FieldDef, v: unknown, value: string, ctx: FilterCtx): boolean {
  if (def.type === "Boolean") return value === "Yes" ? v === true : !v;
  if (def.type === "Person") return (value === "me" ? ctx.me ?? null : value) === v && !blank(v);
  if (NUMERIC.has(def.type)) { const n = Number(value); return Number.isNaN(n) ? true : Number(v) === n && !blank(v); }
  if (isOpenList(def.key)) return !blank(v) && String(v).trim().toLowerCase() === value.trim().toLowerCase(); // open lists: the same value in another case is the same value
  return String(v ?? "") === value;
}

/** True when the row passes every filter. A filter on an unknown field or with an unreadable value filters nothing. */
export function matchesFilters(row: Row, filters: Filter[], ctx: FilterCtx = {}): boolean {
  return filters.every((fl) => {
    const def = FIELD_BY_KEY[fl.field];
    if (!def) return true;
    const v = isDateField(def) ? dayOf(row[fl.field]) : row[fl.field];
    const value = fl.value ?? "";
    switch (fl.op) {
      case "empty": return blank(v);
      case "not_empty": return !blank(v);
      case "is": return isMatch(def, v, value, ctx);
      case "is_not": return !isMatch(def, v, value, ctx);
      case "any_of": {
        const picks = (fl.values ?? []).filter((x) => x !== "");
        return picks.length === 0 ? true : picks.some((x) => isMatch(def, v, x, ctx));
      }
      case "today": case "this_week": case "this_month": {
        const t = ctx.today ?? localToday();
        if (blank(v)) return false;
        const day = (d: number) => new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + d)).toISOString().slice(0, 10);
        const today = day(0);
        const s = String(v);
        if (fl.op === "today") return s === today;
        if (fl.op === "this_month") return s.slice(0, 7) === today.slice(0, 7);
        const back = (t.getUTCDay() + 6) % 7; // Monday is the first day of the week
        return s >= day(-back) && s <= day(6 - back);
      }
      case "contains": return value === "" ? true : String(v ?? "").toLowerCase().includes(value.toLowerCase());
      case "gt": case "lt": {
        const n = Number(value);
        if (value === "" || Number.isNaN(n)) return true;
        if (blank(v)) return false;
        return fl.op === "gt" ? Number(v) > n : Number(v) < n;
      }
      case "before": case "after": {
        if (!ISO.test(value)) return true;
        if (blank(v)) return false;
        return fl.op === "before" ? String(v) < value : String(v) > value;
      }
      case "between": {
        // both ends included; the two dates may be given in either order; one missing end filters nothing yet
        const b = fl.value2 ?? "";
        if (!ISO.test(value) || !ISO.test(b)) return true;
        if (blank(v)) return false;
        const [lo, hi] = value <= b ? [value, b] : [b, value];
        return String(v) >= lo && String(v) <= hi;
      }
      case "in_last": case "in_next": {
        const n = Number(value);
        if (value === "" || !Number.isInteger(n) || n < 0 || n > 3650) return true;
        if (blank(v)) return false;
        const t = ctx.today ?? localToday();
        const day = (d: number) => new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + d)).toISOString().slice(0, 10);
        const today = day(0);
        return fl.op === "in_last" ? String(v) >= day(-n) && String(v) <= today : String(v) >= today && String(v) <= day(n);
      }
      default: return true;
    }
  });
}

/** Free-text search over the code and the name: every word must appear. */
export function matchesSearch(row: Row, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = `${row.item_code ?? ""} ${row.initiative_name ?? ""}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** "MoSCoW is Must": a filter in words, for chips and the palette. */
export function filterSummary(fl: Filter, labels: { person: (id: string) => string; project: (id: string) => string }): string {
  const def = FIELD_BY_KEY[fl.field];
  const name = def?.name ?? fl.field;
  let value = fl.value ?? "";
  if (value !== "" && def?.type === "Person") value = labels.person(value);
  else if (value !== "" && fl.field === "home_project") value = labels.project(value);
  if (fl.op === "any_of") {
    const shown = (fl.values ?? []).map((x) => (def?.type === "Person" ? labels.person(x) : fl.field === "home_project" ? labels.project(x) : x));
    return `${name} is any of ${shown.join(", ")}`;
  }
  if (def && isDateField(def)) {
    // dates are shown in the person's own format
    const show = (iso: string | undefined) => (iso && ISO.test(iso) ? formatDate(iso, localToday()) : iso ?? "");
    if (fl.op === "between") return `${name} is between ${show(fl.value)} and ${show(fl.value2)}`;
    if (fl.op === "in_last") return `${name} is in the last ${value} days`;
    if (fl.op === "in_next") return `${name} is in the next ${value} days`;
    value = show(value);
  }
  return `${name} ${OP_LABEL[fl.op]}${value !== "" ? ` ${value}` : ""}`;
}

// ----------------------------------------------------------------- grouping
export type GroupRow = { __group: true; id: string; key: string; label: string; count: number; collapsed: boolean; /** "3 On Track · 1 At Risk": the health of the rows of the group, in words (empty when none has a health). */ healthSummary: string };

/** The health of some rows in words, in the order of the dictionary's list: "3 On Track · 1 At Risk". Rows without a health are left out. */
export function healthBreakdown(rows: readonly object[]): string {
  const order = FIELD_BY_KEY.health?.allowed ?? [];
  const counts = new Map<string, number>();
  for (const r of rows) { const h = (r as Row).health; if (typeof h === "string" && h) counts.set(h, (counts.get(h) ?? 0) + 1); }
  return [...counts.entries()].sort((a, b) => (order.indexOf(a[0]) < 0 ? 999 : order.indexOf(a[0])) - (order.indexOf(b[0]) < 0 ? 999 : order.indexOf(b[0]))).map(([h, n]) => `${n} ${h}`).join(" · ");
}

/** Fields the grid can group by: lists, people, yes/no and the project. */
export function groupableFields(): FieldDef[] {
  return FIELDS.filter((f) => f.type === "Select" || f.type === "Person" || f.type === "Boolean" || f.key === "home_project");
}

const groupValue = (def: FieldDef | undefined, v: unknown): string => {
  if (blank(v)) return "";
  if (def?.type === "Boolean") return v ? "Yes" : "No";
  return String(v);
};

/**
 * Rows with a header row before each group. Off (null) returns the rows unchanged. Groups follow the field's own list
 * (or their label for people and projects), empty last; rows keep their order inside a group; collapsed groups hide their rows.
 * `collapsed` holds keys like "moscow:Must".
 */
export function buildGroupedRows<T extends { id: string }>(rows: T[], groupBy: string | null, collapsed: ReadonlySet<string>, label: (field: string, value: unknown) => string): (T | GroupRow)[] {
  if (!groupBy) return rows;
  const def = FIELD_BY_KEY[groupBy];
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const k = groupValue(def, (r as Row)[groupBy]);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const order = def && def.allowed.length > 0 ? def.allowed : null;
  const keys = [...groups.keys()].sort((a, b) => {
    if (a === "" || b === "") return a === "" ? 1 : -1;
    if (groupBy === "g2m_quarter" && isQuarter(a) && isQuarter(b)) return compareQuarters(a, b); // time order, also for quarters outside the offered range
    if (order) return (order.indexOf(a) < 0 ? 999 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 999 : order.indexOf(b));
    return label(groupBy, a).localeCompare(label(groupBy, b));
  });
  const out: (T | GroupRow)[] = [];
  for (const k of keys) {
    const items = groups.get(k)!;
    const key = `${groupBy}:${k}`;
    const isCollapsed = collapsed.has(key);
    out.push({ __group: true, id: `group:${key}`, key, label: label(groupBy, k === "" ? null : k), count: items.length, collapsed: isCollapsed, healthSummary: healthBreakdown(items) });
    if (!isCollapsed) out.push(...items);
  }
  return out;
}

// -------------------------------------------------------------------- views
/** What a saved view stores: the columns in order, the filters and the grouping. */
export type ViewDef = { columns: string[]; filters: Filter[]; groupBy: string | null; customerSafe?: boolean; /** The locked columns: at most four, any of the shown columns, kept to the left while the grid scrolls right. Missing means the default: rank, ID and name. An empty list means none. */ pinned?: string[]; /** Ordered sorts, the first is the main one; empty or missing means the global Stack Rank order. An older single sort object is still read. */ sort?: SortDef[] };

/** One sort column and direction. A view holds an ordered list of them: the order of the columns in the picker is the order of the sorts. */
export type SortDef = { field: string; dir: "asc" | "desc" };
/** Fields a view can be sorted by: everything except long text. */
export const sortableFields = () => FIELDS.filter((f) => f.type !== "Long text");
const isSortable = (key: string) => key in FIELD_BY_KEY && FIELD_BY_KEY[key]!.type !== "Long text";

/** Direction words that fit the column's data: A-Z for text, low to high for numbers, oldest first for dates. */
export function sortDirectionLabels(fieldKey: string): { asc: string; desc: string } {
  const t = FIELD_BY_KEY[fieldKey]?.type;
  if (t === "Number" || t === "Currency") return { asc: "Low to high", desc: "High to low" };
  if (t === "Date" || t === "Date range") return { asc: "Oldest first", desc: "Newest first" };
  return { asc: "A-Z", desc: "Z-A" };
}

/** Reads a stored or pasted sort: a list, or the single object older views saved. Unknown, long-text and repeated columns are dropped. */
export function normalizeSorts(input: unknown, allow: (key: string) => boolean = () => true): SortDef[] {
  const list = Array.isArray(input) ? input : input && typeof input === "object" ? [input] : [];
  const out: SortDef[] = [];
  for (const x of list) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    if (typeof r.field !== "string" || !isSortable(r.field) || HIDDEN_FIELDS.has(r.field) || !allow(r.field) || out.some((o) => o.field === r.field)) continue;
    out.push({ field: r.field, dir: r.dir === "desc" ? "desc" : "asc" });
  }
  return out;
}

/** "Sorted by Stack Rank, Low to high"; several read "Sorted by Country, A-Z, then Rank, High to low"; no sort reads as the default order. */
export function sortSummary(sort: SortDef | readonly SortDef[] | null | undefined): string {
  const list = normalizeSorts(sort);
  if (list.length === 0) return "Sorted by global Stack Rank";
  return `Sorted by ${list.map((s) => `${FIELD_BY_KEY[s.field]!.name}, ${sortDirectionLabels(s.field)[s.dir]}`).join(", then ")}`;
}

/** The sorts that apply to the grid, in order: a saved sort on a column the view no longer shows is left out, without an error (none left means the default order). */
export function effectiveSort(view: { columns: readonly string[]; sort?: SortDef | readonly SortDef[] | null }): SortDef[] {
  return normalizeSorts(view.sort, (k) => view.columns.includes(k));
}

/**
 * Orders rows by a view's sorts, the first one first; empty values go last in both directions and ties keep the Stack Rank order.
 * Numbers compare as numbers, everything else as text (dates are stored as ISO text, which sorts correctly).
 */
export function sortRows<T extends Record<string, unknown>>(rows: readonly T[], sort: SortDef | readonly SortDef[] | null | undefined): T[] {
  const sorts = Array.isArray(sort) ? (sort as readonly SortDef[]) : sort ? [sort as SortDef] : [];
  if (sorts.length === 0) return [...rows];
  const empty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
  const rank = (r: T) => (typeof r.stack_rank === "number" ? r.stack_rank : Number.MAX_SAFE_INTEGER);
  return [...rows].sort((a, b) => {
    for (const s of sorts) {
      const x = a[s.field], y = b[s.field];
      if (empty(x) !== empty(y)) return empty(x) ? 1 : -1;
      if (empty(x)) continue;
      const c = typeof x === "number" && typeof y === "number" ? x - y : s.field === "g2m_quarter" && isQuarter(x) && isQuarter(y) ? compareQuarters(x, y) : String(Array.isArray(x) ? x.join(", ") : x).localeCompare(String(Array.isArray(y) ? y.join(", ") : y), "en", { numeric: true, sensitivity: "base" });
      if (c !== 0) return c * (s.dir === "desc" ? -1 : 1);
    }
    return rank(a) - rank(b);
  });
}

/** At most four columns can be locked: they stay on the left while the grid scrolls right. */
export const MAX_PINNED = 4;

/**
 * The columns in the order the grid shows them, and which of them are locked. The core columns come first, then the rest in the given order;
 * locked columns (any, up to four, in that order) move to the left of the unlocked ones. `locked` missing means the default: the core columns.
 */
export function arrangeColumns(columns: readonly string[], locked: readonly string[] | null | undefined, customerSafe = false): { columns: string[]; pinned: string[] } {
  const core = columnsFor(CORE_COLUMN_KEYS, customerSafe);
  const base = [...core, ...new Set(columns.filter((c) => !core.includes(c)))];
  const want = locked ?? core;
  const pinned = base.filter((c) => want.includes(c)).slice(0, MAX_PINNED);
  return { columns: [...pinned, ...base.filter((c) => !pinned.includes(c))], pinned };
}

/** Fields a customer-safe view may hold: exactly the sheet's "Customer-safe reports" flag (Target and Live Markets are included, per Ashu). */
export const CUSTOMER_SAFE_KEYS: readonly string[] = FIELDS.filter((f) => f.customerSafe).map((f) => f.key);
export const isCustomerSafe = (key: string) => CUSTOMER_SAFE_KEYS.includes(key);
/** The columns a view may show to an audience: all of them inside the workspace, only the safe ones for customers. */
export const columnsFor = (columns: readonly string[], customerSafe: boolean) => (customerSafe ? columns.filter(isCustomerSafe) : [...columns]);

/** Makes a stored or pasted view safe to apply: unknown columns, filters and groups are dropped; the core columns come first. */
export function sanitizeView(input: unknown): ViewDef {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const customerSafe = o.customerSafe === true;
  const cols = Array.isArray(o.columns) ? o.columns.filter((c): c is string => typeof c === "string" && c in FIELD_BY_KEY && !HIDDEN_FIELDS.has(c)) : [];
  const { columns, pinned } = arrangeColumns(columnsFor(cols, customerSafe), Array.isArray(o.pinned) ? o.pinned.filter((c): c is string => typeof c === "string") : null, customerSafe);
  const filters: Filter[] = [];
  if (Array.isArray(o.filters)) {
    for (const x of o.filters) {
      if (!x || typeof x !== "object") continue;
      const f = x as Record<string, unknown>;
      const def = typeof f.field === "string" && !HIDDEN_FIELDS.has(f.field) ? FIELD_BY_KEY[f.field] : undefined;
      if (!def || (customerSafe && !isCustomerSafe(def.key)) || typeof f.op !== "string" || !OPS.includes(f.op as FilterOp) || !opsFor(def).some((p) => p.op === f.op)) continue;
      const values = Array.isArray(f.values) ? [...new Set(f.values.filter((x): x is string => typeof x === "string" && x !== "").map((x) => x.slice(0, 200)))].slice(0, 30) : [];
      filters.push({ field: def.key, op: f.op as FilterOp, ...(typeof f.value === "string" ? { value: f.value } : {}), ...(typeof f.value2 === "string" ? { value2: f.value2 } : {}), ...(f.op === "any_of" ? { values } : {}) });
    }
  }
  const groupBy = typeof o.groupBy === "string" && groupableFields().some((g) => g.key === o.groupBy) && !HIDDEN_FIELDS.has(o.groupBy) && (!customerSafe || isCustomerSafe(o.groupBy)) ? o.groupBy : null;
  const sort = normalizeSorts(o.sort, (k) => !customerSafe || isCustomerSafe(k));
  return { columns, filters, groupBy, ...(customerSafe ? { customerSafe: true } : {}), pinned, ...(sort.length > 0 ? { sort } : {}) };
}
