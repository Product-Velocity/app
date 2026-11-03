import { MOSCOW_VALUES, parseFieldMap, type FieldChoice } from "@/lib/atlassian/field-map";
import type { JiraFieldMap } from "@/lib/atlassian/outbound";
import { configSlots, type ConfigRow } from "./mapping";
import { SLOT_BY_ID, type Tracker } from "./slots";

// The field configuration form (one form per project, the same on GitHub and Jira): checkboxes for the things that can be switched off, selects for the
// fields that can be re-pointed. Pure, so the whole form is tested without a browser. "" always means the default.

export const OFF_VALUE = "__off";
export const ON = (slot: string) => `on:${slot}`;
export const FIELD = (slot: string) => `field:${slot}`;
/** The submit button that resets one setting ("all" resets every setting of the project). */
export const RESET = "reset";

type Get = (name: string) => string;
type Has = (name: string) => boolean;

/** Rows of the config table from the form. A reset puts the slot (or every slot) back to the default. */
export function configRowsFromForm(tracker: Tracker, get: Get, has: Has): ConfigRow[] {
  const reset = get(RESET);
  const rows: ConfigRow[] = [];
  for (const s of configSlots(tracker)) {
    if (reset === "all" || reset === s.id) continue;
    if (s.kind === "toggle") { if (!has(ON(s.id))) rows.push({ slot: s.id, enabled: false, field: null }); continue; }
    const v = get(FIELD(s.id));
    if (v === OFF_VALUE) rows.push({ slot: s.id, enabled: false, field: null });
    else if (v !== "") rows.push({ slot: s.id, enabled: true, field: v });
  }
  return rows;
}

/** The Jira field map (start date, theme, priority per MoSCoW value) from the form, reset where asked. */
export function jiraMapFromForm(get: Get): JiraFieldMap {
  const reset = get(RESET);
  const all = reset === "all";
  return parseFieldMap({
    startDate: all || reset === "jira.startDate" ? "" : get(FIELD("jira.startDate")),
    theme: all || reset === "jira.theme" ? "" : get(FIELD("jira.theme")),
    priorityByMoscow: Object.fromEntries(MOSCOW_VALUES.map((m) => [m, all || reset === "jira.priority" ? "" : get(`priority_${m}`)])),
  });
}

/**
 * What the site offers for the three fields that live in the Jira field map. A value that is not offered is refused, and so is a change when the
 * site could not be read (`choices` null): the form then still saves the switches.
 */
export function validateJiraMap(next: JiraFieldMap, stored: JiraFieldMap, choices: { startDates: FieldChoice[]; themes: FieldChoice[]; priorities: FieldChoice[] } | null): string[] {
  const errors: string[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  if (!choices) {
    if (!same(next.startDate, stored.startDate) || !same(next.theme, stored.theme) || !same(next.priorityByMoscow, stored.priorityByMoscow)) errors.push("The fields of this Jira site could not be read just now, so the start date, theme and priority choices could not be checked. Try again in a minute.");
    return errors;
  }
  if (next.startDate && !choices.startDates.some((c) => c.id === next.startDate)) errors.push(`The start date field ${next.startDate} is not a date field of this Jira site.`);
  if (next.theme && !choices.themes.some((c) => c.id === next.theme)) errors.push(`The theme field ${next.theme} is not a single-line text field of this Jira site.`);
  for (const [m, id] of Object.entries(next.priorityByMoscow ?? {})) if (!choices.priorities.some((c) => c.id === id)) errors.push(`The Jira priority for ${m} (${id}) does not exist on this site.`);
  return errors;
}

/** Slot ids a form row can carry, for the tests that keep the form and the closed list together. */
export const formSlots = (t: Tracker) => configSlots(t).map((s) => SLOT_BY_ID.get(s.id)!);
