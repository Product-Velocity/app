import { buildFieldCatalog, type JiraField } from "./field-catalog";
import type { JiraFieldMap } from "./outbound";

// The per-project field mapping of Jira (issue #67, #70): which Jira field holds the start date, and which Jira priority stands for each
// MoSCoW value. Pure functions. What is stored is validated again by the database (jira_set_field_map); what is read is parsed defensively.

export const MOSCOW_VALUES = ["Must", "Should", "Could", "Won't"] as const;
export type Moscow = (typeof MOSCOW_VALUES)[number];
export const START_FIELD = /^customfield_\d{1,9}$/;
export const THEME_FIELD = START_FIELD;
export const PRIORITY_ID = /^\d{1,9}$/;

/** A stored mapping to the shape the sender uses; anything malformed is left out (so a bad value can never reach a Jira request). */
export function parseFieldMap(raw: unknown): JiraFieldMap {
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const out: JiraFieldMap = {};
  if (typeof o.startDate === "string" && START_FIELD.test(o.startDate)) out.startDate = o.startDate;
  if (typeof o.theme === "string" && THEME_FIELD.test(o.theme)) out.theme = o.theme;
  const p = typeof o.priorityByMoscow === "object" && o.priorityByMoscow !== null ? (o.priorityByMoscow as Record<string, unknown>) : {};
  const byMoscow: NonNullable<JiraFieldMap["priorityByMoscow"]> = {};
  for (const m of MOSCOW_VALUES) { const v = p[m]; if (typeof v === "string" && PRIORITY_ID.test(v)) byMoscow[m] = v; }
  if (Object.keys(byMoscow).length > 0) out.priorityByMoscow = byMoscow;
  return out;
}

/** The map from the form: the start date field and one priority per MoSCoW value; an empty choice leaves that value unmapped. */
export function fieldMapFromForm(get: (key: string) => string): JiraFieldMap {
  return parseFieldMap({ startDate: get("startDate"), theme: get("theme"), priorityByMoscow: Object.fromEntries(MOSCOW_VALUES.map((m) => [m, get(`priority_${m}`)])) });
}

export type FieldChoice = { id: string; name: string };
/** Date fields a person can pick as "Start date": custom fields of date type, the one named Start date first. */
export function startDateChoices(fields: JiraField[]): FieldChoice[] {
  const rows = buildFieldCatalog(fields, []).filter((r) => r.custom && r.kind === "date" && START_FIELD.test(r.id));
  return rows.sort((a, b) => Number(b.role === "start_date") - Number(a.role === "start_date") || a.name.localeCompare(b.name)).map((r) => ({ id: r.id, name: r.name }));
}
/**
 * Fields a person can pick for the Focus Area ("Theme"): custom SINGLE-LINE text fields only, the one named Theme first. Select fields
 * are not offered (Jira rejects a value that is not one of its options and PV never creates options); paragraph (multi-line) fields are not
 * offered either, because Jira's v3 API wants rich text (ADF) there, not a plain string.
 */
export function themeChoices(fields: JiraField[]): FieldChoice[] {
  const isTheme = (name: string) => /^theme$/i.test(name.trim());
  return fields
    .filter((f) => f.custom && THEME_FIELD.test(f.id) && f.schema?.type === "string" && (f.schema.custom ?? "").endsWith(":textfield"))
    .sort((a, b) => Number(isTheme(b.name)) - Number(isTheme(a.name)) || a.name.localeCompare(b.name))
    .map((f) => ({ id: f.id, name: f.name }));
}
/** The Jira priorities of the site, in the order Jira lists them (highest first). */
export function priorityChoices(raw: unknown): FieldChoice[] {
  return (Array.isArray(raw) ? raw : []).flatMap((p): FieldChoice[] => {
    const o = typeof p === "object" && p !== null ? (p as Record<string, unknown>) : {};
    return typeof o.id === "string" && PRIORITY_ID.test(o.id) && typeof o.name === "string" ? [{ id: o.id, name: o.name.slice(0, 100) }] : [];
  });
}
/** A first proposal for the priorities: highest = Must, next = Should, next = Could, lowest = Won't. Only a proposal; a person confirms. */
export function proposePriorities(choices: FieldChoice[]): Partial<Record<Moscow, string>> {
  if (choices.length < 4) return {};
  return { Must: choices[0]!.id, Should: choices[1]!.id, Could: choices[2]!.id, "Won't": choices[choices.length - 1]!.id };
}
