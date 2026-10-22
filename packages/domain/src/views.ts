import { FIELDS, FIELD_BY_KEY, type FieldDef } from "./registry";

/** The columns every view shows and keeps on the left, so a row always says which initiative it is. */
export const CORE_COLUMN_KEYS = ["stack_rank", "item_code", "initiative_name"] as const;

// ------------------------------------------------------------------ filters
export type FilterOp = "is" | "is_not" | "contains" | "gt" | "lt" | "before" | "after" | "empty" | "not_empty";
export type Filter = { field: string; op: FilterOp; value?: string };

const OP_LABEL: Record<FilterOp, string> = {
  is: "is", is_not: "is not", contains: "contains", gt: "is greater than", lt: "is less than",
  before: "is before", after: "is after", empty: "is empty", not_empty: "is not empty",
};
const OPS = Object.keys(OP_LABEL) as FilterOp[];
const NUMERIC = new Set(["Number", "Currency", "Computed"]);
const TEXTUAL = new Set(["Text", "Long text", "Person or text"]);
const op = (o: FilterOp) => ({ op: o, label: OP_LABEL[o] });

/** The operators that make sense for a field, in the order they are offered. */
export function opsFor(f: FieldDef): { op: FilterOp; label: string }[] {
  if (f.type === "Boolean") return [op("is")];
  if (f.type === "Date") return (["before", "after", "is", "empty", "not_empty"] as const).map(op);
  if (NUMERIC.has(f.type)) return (["gt", "lt", "is", "empty", "not_empty"] as const).map(op);
  if (TEXTUAL.has(f.type)) return (["contains", "is", "empty", "not_empty"] as const).map(op);
  if (f.type === "Select" || f.type === "Person" || f.key === "home_project") return (["is", "is_not", "empty", "not_empty"] as const).map(op);
  return (["contains", "empty", "not_empty"] as const).map(op); // tags, links and other values shown as text
}

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
        if (!/^\d{4}-\d\d-\d\d$/.test(value)) return true;
        if (blank(v)) return false;
        return fl.op === "before" ? String(v) < value : String(v) > value;
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
  return `${name} ${OP_LABEL[fl.op]}${value !== "" ? ` ${value}` : ""}`;
}

// ----------------------------------------------------------------- grouping
export type GroupRow = { __group: true; id: string; key: string; label: string; count: number; collapsed: boolean };

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
    out.push({ __group: true, id: `group:${key}`, key, label: label(groupBy, k === "" ? null : k), count: items.length, collapsed: isCollapsed });
    if (!isCollapsed) out.push(...items);
  }
  return out;
}

// -------------------------------------------------------------------- views
/** What a saved view stores: the columns in order, the filters and the grouping. */
export type ViewDef = { columns: string[]; filters: Filter[]; groupBy: string | null; customerSafe?: boolean };

/**
 * The sheet marks Target Markets and Live Markets "customer-safe", but `docs/03` and CLAUDE.md rule 2 treat markets as commercial
 * (hidden from customer-safe views unless an audience profile allows them). The stricter rule wins until Ashu says otherwise.
 */
export const CUSTOMER_SAFE_EXCLUDED: readonly string[] = ["target_scope", "live_scope"];
/** Fields a customer-safe view may hold: the sheet's "Customer-safe reports" flag, minus the exclusions above. */
export const CUSTOMER_SAFE_KEYS: readonly string[] = FIELDS.filter((f) => f.customerSafe && !CUSTOMER_SAFE_EXCLUDED.includes(f.key)).map((f) => f.key);
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
      filters.push({ field: def.key, op: f.op as FilterOp, ...(typeof f.value === "string" ? { value: f.value } : {}) });
    }
  }
  const groupBy = typeof o.groupBy === "string" && groupableFields().some((g) => g.key === o.groupBy) && (!customerSafe || isCustomerSafe(o.groupBy)) ? o.groupBy : null;
  return { columns, filters, groupBy, ...(customerSafe ? { customerSafe: true } : {}) };
}
