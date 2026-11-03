import type { JiraKind } from "@pv/domain";
import { adfToText } from "./adf";

// The rule for HOW a Jira value is read and written, per kind of field (docs/16 point 3; spike J2 found that Team and Parent come back as objects).
// Pure. The sync sessions use these two functions with a mapping from `loadFieldMappings`; a value that does not fit comes back as null and is
// skipped, never guessed. Jira text is data: nothing here is interpreted, only copied, trimmed and cut to a length.

export type MappedValue = string | number | string[] | null;
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const MAX_TEXT = 4000;
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, MAX_TEXT);
const DATE = /^(\d{4}-\d{2}-\d{2})(?:$|T)/;

function optionText(v: unknown): string | null {
  if (typeof v === "string") return clean(v) || null;
  if (!isObj(v)) return null;
  const own = typeof v.value === "string" ? v.value : typeof v.name === "string" ? v.name : "";
  const child = isObj(v.child) ? optionText(v.child) : null; // a cascading select: "Parent / Child"
  const text = clean(own);
  return text ? (child ? `${text} / ${child}` : text) : null;
}

/** A Jira value as the mapping reads it: text, a number, a date (YYYY-MM-DD), one choice as its text, or a list of strings (choices, labels, people's account ids, team and sprint names). */
export function readJiraValue(kind: JiraKind, raw: unknown): MappedValue {
  if (raw === null || raw === undefined) return null;
  switch (kind) {
    case "text": {
      if (typeof raw === "string") return clean(raw) || null;
      if (isObj(raw) && raw.type === "doc") return clean(adfToText(raw)) || null; // rich text fields come back as Atlassian Document Format
      return null;
    }
    case "number":
      return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    case "date":
    case "datetime": {
      const m = typeof raw === "string" ? DATE.exec(raw) : null;
      return m ? m[1]! : null;
    }
    case "select":
      return optionText(raw);
    case "multi-select":
      return Array.isArray(raw) ? raw.map(optionText).filter((x): x is string => x !== null) : null;
    case "labels":
      return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").map(clean).filter(Boolean) : null;
    case "user":
      return isObj(raw) && typeof raw.accountId === "string" && raw.accountId ? raw.accountId : null; // the account id only; never an email
    case "users":
      return Array.isArray(raw) ? raw.flatMap((u) => (isObj(u) && typeof u.accountId === "string" && u.accountId ? [u.accountId] : [])) : null;
    case "team": {
      if (!isObj(raw)) return null;
      const name = typeof raw.name === "string" ? raw.name : typeof raw.title === "string" ? raw.title : "";
      return clean(name) || null;
    }
    case "parent":
      return isObj(raw) && typeof raw.key === "string" && /^[A-Z][A-Z0-9_]+-\d+$/.test(raw.key) ? raw.key : null;
    case "sprint":
      return Array.isArray(raw) ? raw.flatMap((s) => (isObj(s) && typeof s.name === "string" && clean(s.name) ? [clean(s.name)] : [])) : null;
    case "link":
      return typeof raw === "string" && /^https:\/\//.test(raw) ? raw.slice(0, 2000) : null;
    default:
      return null; // "other": no rule yet
  }
}

/**
 * A PV value as Jira's REST API v3 takes it for a field, or null when this kind cannot be written (people, teams, sprints, parents and unknown
 * objects are read only; docs/16 and the mapping check refuse two-way for them). A custom select takes `{ value }`, the system Priority `{ name }`.
 */
export function toJiraValue(field: { id: string; custom: boolean; kind: JiraKind }, value: unknown): unknown {
  if (value === null || value === undefined || value === "") return null;
  switch (field.kind) {
    case "text":
      return typeof value === "string" ? clean(value) : null;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    case "date": {
      const m = typeof value === "string" ? DATE.exec(value) : null;
      return m ? m[1]! : null;
    }
    case "datetime": {
      const m = typeof value === "string" ? DATE.exec(value) : null;
      return m ? `${m[1]}T00:00:00.000+0000` : null;
    }
    case "select": {
      if (typeof value !== "string" || !clean(value)) return null;
      return field.id === "priority" && !field.custom ? { name: clean(value) } : { value: clean(value) };
    }
    case "labels": {
      const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
      // Jira labels cannot contain spaces
      const labels = list.filter((x): x is string => typeof x === "string").map((x) => clean(x).replace(/\s+/g, "-")).filter(Boolean);
      return labels.length > 0 ? [...new Set(labels)] : null;
    }
    default:
      return null;
  }
}
