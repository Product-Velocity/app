import { formatDate, localToday } from "./dates";
import { FIELDS, FIELD_BY_KEY, type FieldDef } from "./registry";

/** The columns every view shows and keeps on the left, so a row always says which initiative it is. */
export const CORE_COLUMN_KEYS = ["stack_rank", "item_code", "initiative_name"] as const;

// ------------------------------------------------------------------ filters
export type FilterOp = "is" | "is_not" | "contains" | "gt" | "lt" | "before" | "after" | "between" | "in_last" | "in_next" | "empty" | "not_empty";
/** `value2` is the second date of "between". For "in the last / next" the value is a number of days. */
export type Filter = { field: string; op: FilterOp; value?: string; value2?: string };

const OP_LABEL: Record<FilterOp, string> = {
  is: "is", is_not: "is not", contains: "contains", gt: "is greater than", lt: "is less than",
  before: "is before", after: "is after", between: "is between", in_last: "is in the last (days)", in_next: "is in the next (days)", empty: "is empty", not_empty: "is not empty",
};
const OPS = Object.keys(OP_LABEL) as FilterOp[];
const NUMERIC = new Set(["Number", "Currency", "Computed"]);
const TEXTUAL = new Set(["Text", "Long text", "Person or text"]);
const op = (o: FilterOp) => ({ op: o, label: OP_LABEL[o] });

/** The operators that make sense for a field, in the order they are offered. */
export function opsFor(f: FieldDef): { op: FilterOp; label: string }[] {
  if (f.type === "Boolean") return [op("is")];
  if (f.type === "Date") return (["before", "after", "between", "is", "in_last", "in_next", "empty", "not_empty"] as const).map(op);
  if (NUMERIC.has(f.type)) return (["gt", "lt", "is", "empty", "not_empty"] as const).map(op);
  if (TEXTUAL.has(f.type)) return (["contains", "is", "empty", "not_empty"] as const).map(op);
  if (f.type === "Select" || f.type === "Person" || f.key === "home_project") return (["is", "is_not", "empty", "not_empty"] as const).map(op);
  return (["contains", "empty", "not_empty"] as const).map(op); // tags, links and other values shown as text
}

const ISO = /^\d{4}-\d\d-\d\d$/;
type Row = Record<string, unknown>;
export type FilterCtx = { me?: string | null; today?: Date };
const blank = (v: unknown) => v === null || v === undefined || v === "";

function isMatch(def: FieldDef, v: unknown, value: string, ctx: FilterCtx): boolean {
  if (def.type === "Boolean") return value === "Yes" ? v === true : !v;
  if (def.type === "Person") return (value === "me" ? ctx.me ?? null : value) === v && !blank(v);
  if (NUMERIC.has(def.type)) { const n = Number(value); return Number.isNaN(n) ? true : Number(v) === n && !blank(v); }
  return String(v ?? "") === value;
}

/** True when the row passes every filter. A filter on an unknown field or with an unreadable value filters nothing. */
export function matchesFilters(row: Row, filters: Filter[], ctx: FilterCtx = {}): boolean {
  return filters.every((fl) => {
    const def = FIELD_BY_KEY[fl.field];
    if (!def) return true;
    const v = row[fl.field];
    const value = fl.value ?? "";
    switch (fl.op) {
      case "empty": return blank(v);
      case "not_empty": return !blank(v);
      case "is": return isMatch(def, v, value, ctx);
      case "is_not": return !isMatch(def, v, value, ctx);
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
  if (def?.type === "Date") {
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
export type ViewDef = { columns: string[]; filters: Filter[]; groupBy: string | null; customerSafe?: boolean };

/** Fields a customer-safe view may hold: exactly the sheet's "Customer-safe reports" flag (Target and Live Markets are included, per Ashu). */
export const CUSTOMER_SAFE_KEYS: readonly string[] = FIELDS.filter((f) => f.customerSafe).map((f) => f.key);
export const isCustomerSafe = (key: string) => CUSTOMER_SAFE_KEYS.includes(key);
/** The columns a view may show to an audience: all of them inside the workspace, only the safe ones for customers. */
export const columnsFor = (columns: readonly string[], customerSafe: boolean) => (customerSafe ? columns.filter(isCustomerSafe) : [...columns]);

/** Makes a stored or pasted view safe to apply: unknown columns, filters and groups are dropped; the core columns come first. */
export function sanitizeView(input: unknown): ViewDef {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const customerSafe = o.customerSafe === true;
  const cols = Array.isArray(o.columns) ? o.columns.filter((c): c is string => typeof c === "string" && c in FIELD_BY_KEY) : [];
  // the pinned core columns come first; a customer-safe view keeps only the core columns that are safe (ID and name)
  const core = columnsFor(CORE_COLUMN_KEYS, customerSafe);
  const columns = [...core, ...new Set(columnsFor(cols, customerSafe).filter((c) => !core.includes(c)))];
  const filters: Filter[] = [];
  if (Array.isArray(o.filters)) {
    for (const x of o.filters) {
      if (!x || typeof x !== "object") continue;
      const f = x as Record<string, unknown>;
      const def = typeof f.field === "string" ? FIELD_BY_KEY[f.field] : undefined;
      if (!def || (customerSafe && !isCustomerSafe(def.key)) || typeof f.op !== "string" || !OPS.includes(f.op as FilterOp) || !opsFor(def).some((p) => p.op === f.op)) continue;
      filters.push({ field: def.key, op: f.op as FilterOp, ...(typeof f.value === "string" ? { value: f.value } : {}), ...(typeof f.value2 === "string" ? { value2: f.value2 } : {}) });
    }
  }
  const groupBy = typeof o.groupBy === "string" && groupableFields().some((g) => g.key === o.groupBy) && (!customerSafe || isCustomerSafe(o.groupBy)) ? o.groupBy : null;
  return { columns, filters, groupBy, ...(customerSafe ? { customerSafe: true } : {}) };
}
