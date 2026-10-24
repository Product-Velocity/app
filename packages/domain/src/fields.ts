import { parseDate } from "./dates";
import { parseValue } from "./money";
import { FIELDS, FIELD_BY_KEY, isShipped, type FieldDef } from "./registry";

export type Role = "viewer" | "commenter" | "creator" | "admin" | "leadership";

/** Dictionary field key (`initiative_name`, `moscow`, `home_project`, ...). */
export type EditableField = string;
export type Option = { value: string; label: string };

/** Types the grid edits with a single cell editor. Tags, links, files, relations and structured values need their own panel. */
const SCALAR_TYPES = new Set(["Select", "Text", "Long text", "Number", "Currency", "Date", "Person", "Person or text", "Boolean"]);
const isGridEditable = (f: FieldDef) =>
  f.editable && isShipped(f) && f.key !== "stack_rank" && (SCALAR_TYPES.has(f.type) || f.key === "home_project");

/** Fields a person can edit in a grid cell today: the dictionary says Editable, the phase has shipped, one cell is enough. */
export const EDITABLE_FIELDS: readonly string[] = FIELDS.filter(isGridEditable).map((f) => f.key);
export const fieldLabel = (key: string): string => FIELD_BY_KEY[key]?.name ?? key;

/** Cannot be empty (also: the database column is NOT NULL). */
const NOT_EMPTY = new Set(["initiative_name", "home_project", "visibility", "archived", "date_precision"]);
export const canBeEmpty = (key: string) => !NOT_EMPTY.has(key);

/** Why a cell cannot be edited, in words a person understands; null when it can be. */
export function readOnlyReason(key: string): string | null {
  const f = FIELD_BY_KEY[key];
  if (!f) return "That field does not exist.";
  if (key === "stack_rank") return null; // typed rank moves the item
  if (f.mode === "locked" || f.storage.startsWith("GitHub-synced")) return `${f.name} comes from GitHub and cannot be edited here. Change it on the GitHub issue.`;
  if (f.mode === "computed") return `${f.name} is calculated from other fields and cannot be edited.`;
  if (f.mode === "system") return `${f.name} is set by the system and cannot be edited.`;
  if (!isShipped(f)) return `${f.name} arrives in phase ${f.phase}.`;
  if (!isGridEditable(f)) return `${f.name} cannot be edited in the grid yet. It will be edited in the item panel.`;
  return null;
}

/** Why a field cannot be set on many rows at once, or null when it can. Bulk edit follows the same rules as a cell, and rank is one item at a time. */
export function bulkEditReason(key: string): string | null {
  if (key === "stack_rank") return "Stack Rank is changed one item at a time: type a rank in the Stack Rank cell.";
  return readOnlyReason(key);
}

export const YES_NO: Option[] = [{ value: "Yes", label: "Yes" }, { value: "No", label: "No" }];

/** Options of a select field, exactly as the dictionary spells them (a text label is always shown). */
export function optionsFor(key: string): Option[] {
  const f = FIELD_BY_KEY[key];
  if (f?.type === "Boolean") return YES_NO;
  return (f?.allowed ?? []).map((v) => ({ value: v, label: v }));
}

/** The database allows writes by creators and admins; the grid mirrors that. */
export function canEditItems(role: string | null | undefined): boolean {
  return role === "creator" || role === "admin";
}

export type EditResult = { ok: true; value: string | number | boolean | null } | { ok: false; error: string };

const MAX_LENGTH: Record<string, number> = { initiative_name: 300, summary: 4000, value_proposition: 4000, theme: 120 };
const NON_NEGATIVE = new Set(["customers_requesting", "target_customers", "time_to_first_revenue_months", "estimate_low_weeks", "estimate_high_weeks"]);
const WHOLE = new Set(["customers_requesting", "target_customers"]);
/** Date fields where a quarter or month means its last day. */
const END_DATES = new Set(["g2m_date_est", "g2m_date_actual"]);
/** What a period such as "Q2" means for a date field: its first day for a start, its last day for an end. */
export const dateEdge = (key: string): "start" | "end" => (END_DATES.has(key) ? "end" : "start");
const TEXT_LIMIT: Record<string, number> = { Text: 2000, "Long text": 8000, "Person or text": 200 };

/** Turn what a person typed (or picked) into the value to save, or say what is wrong. */
export function validateEdit(key: string, raw: string, ctx: { today?: Date } = {}): EditResult {
  const reason = readOnlyReason(key);
  const f = FIELD_BY_KEY[key];
  if (!f || reason || !EDITABLE_FIELDS.includes(key)) return { ok: false, error: reason ?? "That field cannot be edited." };
  const text = raw.trim();
  if (text === "") {
    if (f.key === "home_project") return { ok: false, error: "Choose a project." };
    if (f.key === "initiative_name") return { ok: false, error: "An initiative needs a name." };
    return canBeEmpty(key) ? { ok: true, value: null } : { ok: false, error: `${f.name} cannot be empty.` };
  }
  switch (f.type) {
    case "Select": {
      if (f.allowed.length === 0) {
        const max = MAX_LENGTH[key] ?? 120;
        return text.length > max ? { ok: false, error: `Keep it under ${max} characters.` } : { ok: true, value: text };
      }
      const hit = f.allowed.find((v) => v.toLowerCase() === text.toLowerCase());
      return hit ? { ok: true, value: hit } : { ok: false, error: "Choose one of the listed options." };
    }
    case "Boolean": {
      if (/^(yes|true|y)$/i.test(text)) return { ok: true, value: true };
      if (/^(no|false|n)$/i.test(text)) return { ok: true, value: false };
      return { ok: false, error: "Choose Yes or No." };
    }
    case "Currency": {
      const r = parseValue(text);
      return r.ok ? { ok: true, value: r.value } : r;
    }
    case "Number": {
      const n = /^-?\d+(\.\d+)?$/.test(text.replace(/[,\s]/g, "")) ? Number(text.replace(/[,\s]/g, "")) : NaN;
      if (!Number.isFinite(n)) return { ok: false, error: "Enter a number." };
      if (NON_NEGATIVE.has(key) && n < 0) return { ok: false, error: "Enter zero or more." };
      if (WHOLE.has(key) && !Number.isInteger(n)) return { ok: false, error: "Enter a whole number." };
      return { ok: true, value: n };
    }
    case "Date": {
      const r = parseDate(text, ctx.today ?? new Date(), { edge: END_DATES.has(key) ? "end" : "start" });
      return r.ok ? { ok: true, value: r.iso } : r;
    }
    case "Person":
      return { ok: true, value: text };
    default: {
      // Text, Long text, Person or text, and the project relation
      if (f.key === "home_project") return { ok: true, value: text };
      const max = MAX_LENGTH[key] ?? TEXT_LIMIT[f.type] ?? 2000;
      return text.length > max ? { ok: false, error: `Keep it under ${max.toLocaleString("en-GB")} characters.` } : { ok: true, value: text };
    }
  }
}
