// What Claude can read through the MCP server (docs/20-CLAUDE-MCP.md FR-2 and FR-3): the field schema and search.
// Pure and shared with the grid's rules: the same registry, the same filter operators, the same filter engine.

import { EDITABLE_FIELDS, canEditItems, fieldMaxLength } from "./fields";
import { FIELDS, FIELD_BY_KEY, isShipped, type FieldDef } from "./registry";
import { matchesFilters, opsFor, sortRows, type Filter, type FilterCtx, type FilterOp, type SortDef } from "./views";

/**
 * Fields Claude may never set, whatever the role (CLAUDE.md rule 3; docs/20 section 5): Stack Rank, Decision and its trail,
 * Value and everything commercial that hangs on it, and the Ready for build mark. The database also refuses some of them;
 * this list keeps them out of the tool schemas too. Value Type is not on it: it is the one exception (docs/22 section 6), set only
 * with the person's own words as the basis (`value_type_basis`, `CLAUDE_BASIS_FIELDS`).
 */
export const CLAUDE_FORBIDDEN_FIELDS: readonly string[] = [
  "stack_rank", "previous_rank",
  "decision", "decided_by", "decision_date",
  "value_12m", "value_basis", "confidence", "time_to_first_revenue_months", "customers_requesting",
  "ready_for_build", "ready_for_build_by", "current_gate", "gate_status",
];

/** Fields Claude may set only together with the person's own words as the basis (CLAUDE.md rule 3). */
export const CLAUDE_BASIS_FIELDS: readonly string[] = ["value_type"];

/** The list fields (tags, markets, segments, teams, links, relations) Claude can write; each lives in its own table. */
export const CLAUDE_LIST_FIELDS: readonly string[] = ["tags", "target_scope", "live_scope", "target_segments", "contributing_teams", "artifacts", "depends_on", "related_to"];

const editableBy = (f: FieldDef, role: string) => f.editable && isShipped(f) && canEditItems(role);

/**
 * True when Claude, acting as a person with this role, may set the field: editable, shipped, not on the forbidden list, and
 * of a kind the write tools can carry (a single value or one of the list fields; structured values need the app's panel).
 */
export function claudeMaySet(key: string, role: string): boolean {
  const f = FIELD_BY_KEY[key];
  return Boolean(f) && editableBy(f!, role) && !CLAUDE_FORBIDDEN_FIELDS.includes(key) && (EDITABLE_FIELDS.includes(key) || CLAUDE_LIST_FIELDS.includes(key));
}

export type FieldInfo = {
  key: string; label: string; type: string; group: string;
  /** Present for selects: the exact values the database accepts. */
  allowed?: string[];
  max_length?: number;
  /** Whether this caller can edit the field in the app. */
  editable: boolean;
  /** Whether Claude may set it for this caller (false for the forbidden list and everything read-only). */
  claude_may_set: boolean;
  /** True when Claude must also send value_type_basis: the person's own words that say it. */
  needs_basis?: boolean;
  phase: number;
  shipped: boolean;
  reaches_github: boolean;
  customer_safe: boolean;
  /** Why it cannot be set, for fields that are read-only. */
  read_only?: string;
};

const MODE_NOTE: Record<string, string> = { computed: "calculated", system: "set by the system", locked: "comes from GitHub" };

/** The field registry as Claude sees it. Generated from the same source as the grid columns. */
export function describeFields(o: { role: string; reachesGithub: (key: string) => boolean }): FieldInfo[] {
  return FIELDS.map((f) => {
    const max = fieldMaxLength(f.key);
    return {
      key: f.key, label: f.name, type: f.type, group: f.group,
      ...(f.allowed.length > 0 ? { allowed: [...f.allowed] } : {}),
      ...(max !== undefined ? { max_length: max } : {}),
      editable: editableBy(f, o.role),
      claude_may_set: claudeMaySet(f.key, o.role),
      ...(CLAUDE_BASIS_FIELDS.includes(f.key) ? { needs_basis: true } : {}),
      phase: f.phase, shipped: isShipped(f),
      reaches_github: o.reachesGithub(f.key),
      customer_safe: f.customerSafe,
      ...(f.mode !== "editable" ? { read_only: MODE_NOTE[f.mode] } : CLAUDE_FORBIDDEN_FIELDS.includes(f.key) ? { read_only: "only a person sets this" } : {}),
    };
  });
}

// ---------------------------------------------------------------- search
export type SearchRow = { id: string } & Record<string, unknown>;
export type SearchQuery = { text: string; filters: Filter[]; limit: number; offset: number; fields: string[] | "all"; sort: SortDef | null };
export type SearchNames = { projects: { id: string; name: string }[]; members: { id: string; name: string }[] };
export const MAX_SEARCH_LIMIT = 100;
export const DEFAULT_SEARCH_LIMIT = 25;
export const MAX_SEARCH_FILTERS = 20;
/** What a search returns per initiative unless the caller asks for other fields. */
export const DEFAULT_SEARCH_FIELDS: readonly string[] = ["item_code", "initiative_name", "status", "initiative_phase", "home_project", "theme", "moscow", "health", "stack_rank"];
const ALWAYS = ["item_code", "initiative_name"];
const OPS: readonly FilterOp[] = ["is", "is_not", "any_of", "contains", "gt", "lt", "before", "after", "between", "in_last", "in_next", "today", "this_week", "this_month", "empty", "not_empty"];

type Parsed = { ok: true; query: SearchQuery } | { ok: false; error: string };
const fail = (error: string): Parsed => ({ ok: false, error });
const list = (xs: readonly string[], max = 12) => (xs.length > max ? `${xs.slice(0, max).join(", ")}, …` : xs.join(", "));
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Turns a name (or id) into the id the grid filters on; case-insensitive. */
function resolve(raw: string, options: { id: string; name: string }[]): string | null {
  const l = raw.toLowerCase();
  return options.find((o) => o.id === raw)?.id ?? options.find((o) => o.name.toLowerCase() === l)?.id ?? null;
}

/** Checks one filter against the registry and the operators the grid offers for that field; resolves names to ids. */
function checkFilter(raw: unknown, names: SearchNames): { ok: true; filter: Filter } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Each filter needs a field, an op and usually a value." };
  const r = raw as Record<string, unknown>;
  const def = FIELD_BY_KEY[str(r.field)];
  if (!def) return { ok: false, error: `Unknown field "${str(r.field)}" in a filter. Call describe_fields for the list.` };
  const op = str(r.op) as FilterOp;
  const allowedOps = opsFor(def).map((o) => o.op);
  if (!OPS.includes(op) || !allowedOps.includes(op)) return { ok: false, error: `Field ${def.key} does not support the filter "${str(r.op)}". Use one of: ${allowedOps.join(", ")}.` };
  const isPerson = def.type === "Person";
  const isProject = def.key === "home_project";
  const one = (v: unknown): { ok: true; value: string } | { ok: false; error: string } => {
    const s = typeof v === "number" ? String(v) : str(v);
    if (s === "") return { ok: true, value: "" };
    if (isPerson) {
      if (s.toLowerCase() === "me") return { ok: true, value: "me" };
      const id = resolve(s, names.members);
      return id ? { ok: true, value: id } : { ok: false, error: `No member called "${s}" for ${def.key}. Call get_workspace_context for the members.` };
    }
    if (isProject) {
      const id = resolve(s, names.projects);
      return id ? { ok: true, value: id } : { ok: false, error: `No project called "${s}". Projects: ${list(names.projects.map((p) => p.name))}.` };
    }
    if (def.type === "Select" && def.allowed.length > 0 && (op === "is" || op === "is_not" || op === "any_of")) {
      const hit = def.allowed.find((a) => a.toLowerCase() === s.toLowerCase());
      return hit ? { ok: true, value: hit } : { ok: false, error: `"${s}" is not a value of ${def.key}. Allowed: ${def.allowed.join(", ")}.` };
    }
    return { ok: true, value: s };
  };
  const out: Filter = { field: def.key, op };
  if (r.value !== undefined) { const v = one(r.value); if (!v.ok) return v; out.value = v.value; }
  if (r.value2 !== undefined) out.value2 = str(r.value2);
  if (op === "any_of") {
    const arr = Array.isArray(r.values) ? r.values : [];
    const vals: string[] = [];
    for (const x of arr) { const v = one(x); if (!v.ok) return v; if (v.value) vals.push(v.value); }
    out.values = vals;
  }
  return { ok: true, filter: out };
}

/** Reads and validates the arguments of search_items. Errors are written for Claude to fix its next call. */
export function readSearch(args: Record<string, unknown>, names: SearchNames): Parsed {
  const filters: Filter[] = [];
  // the shortcuts are ordinary filters, so they behave exactly like the grid's
  const shortcut = (field: string, raw: unknown) => {
    const s = str(raw);
    return s ? checkFilter({ field, op: "is", value: s }, names) : null;
  };
  for (const [field, arg] of [["home_project", args.project], ["theme", args.group], ["status", args.status], ["initiative_phase", args.phase]] as const) {
    const c = shortcut(field, arg);
    if (!c) continue;
    if (!c.ok) return fail(c.error);
    filters.push(c.filter);
  }
  if (args.filters !== undefined) {
    if (!Array.isArray(args.filters)) return fail("filters must be a list.");
    if (args.filters.length + filters.length > MAX_SEARCH_FILTERS) return fail(`At most ${MAX_SEARCH_FILTERS} filters.`);
    for (const f of args.filters) {
      const c = checkFilter(f, names);
      if (!c.ok) return fail(c.error);
      filters.push(c.filter);
    }
  }
  let fields: SearchQuery["fields"] = [...DEFAULT_SEARCH_FIELDS];
  if (args.fields === "all") fields = "all";
  else if (args.fields !== undefined) {
    if (!Array.isArray(args.fields)) return fail('fields must be a list of field keys, or "all".');
    const bad = args.fields.filter((k) => typeof k !== "string" || !FIELD_BY_KEY[k]);
    if (bad.length > 0) return fail(`Unknown field${bad.length > 1 ? "s" : ""}: ${bad.map(String).join(", ")}. Call describe_fields for the list.`);
    fields = [...new Set([...ALWAYS, ...(args.fields as string[])])];
  }
  let sort: SortDef | null = null;
  if (args.sort !== undefined && args.sort !== null) {
    const s = args.sort as Record<string, unknown>;
    const def = FIELD_BY_KEY[str(s.field)];
    if (!def || def.type === "Long text") return fail(`Cannot sort by "${str(s.field)}".`);
    sort = { field: def.key, dir: s.dir === "desc" ? "desc" : "asc" };
  }
  const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : d);
  return {
    ok: true,
    query: {
      text: str(args.text), filters, fields, sort,
      limit: Math.min(MAX_SEARCH_LIMIT, Math.max(1, n(args.limit, DEFAULT_SEARCH_LIMIT))),
      offset: Math.max(0, n(args.offset, 0)),
    },
  };
}

const TEXT_KEYS = ["item_code", "initiative_name", "summary", "description", "hypothesis"];
/** Every word must appear in the code, name, summary, description or hypothesis (the grid's own search looks at code and name only). */
export function matchesText(row: Record<string, unknown>, text: string): boolean {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = TEXT_KEYS.map((k) => String(row[k] ?? "")).join("\n").toLowerCase();
  return words.every((w) => hay.includes(w));
}

export type SearchResult = { total: number; returned: number; next_offset: number | null; items: SearchRow[] };

/** Filters, sorts and pages rows with the grid's own engine. Rows arrive in global Stack Rank order and keep it unless a sort is given. */
export function runSearch(rows: readonly SearchRow[], q: SearchQuery, ctx: FilterCtx = {}): SearchResult {
  const hits = rows.filter((r) => matchesFilters(r, q.filters, ctx) && matchesText(r, q.text));
  const ordered = q.sort ? sortRows(hits, q.sort) : hits;
  const page = ordered.slice(q.offset, q.offset + q.limit);
  const items = page.map((r) => {
    if (q.fields === "all") return r;
    const o: SearchRow = { id: r.id };
    for (const k of q.fields) o[k] = r[k] ?? null;
    return o;
  });
  const end = q.offset + page.length;
  return { total: ordered.length, returned: page.length, next_offset: end < ordered.length ? end : null, items };
}
