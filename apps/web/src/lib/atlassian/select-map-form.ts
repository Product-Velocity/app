import { SELECT_SLOTS, parseSelectMap, type SelectMap } from "./select-map";

// The form of the "Initiative fields" card (issue #512): per slot a Jira field, a direction and one Jira option per Product Velocity value.
// "" always means "not mapped". Pure, so the form is tested without a browser.
export const SEL_FIELD = (slot: string) => `selfield:${slot}`;
export const SEL_DIR = (slot: string) => `seldir:${slot}`;
export const SEL_OPT = (slot: string, value: string) => `selopt:${slot}:${value}`;

export function selectMapFromForm(get: (name: string) => string): SelectMap {
  const raw: Record<string, unknown> = {};
  for (const s of SELECT_SLOTS) {
    const field = get(SEL_FIELD(s.slot));
    if (!field) continue;
    raw[s.slot] = { field, direction: get(SEL_DIR(s.slot)) || "to_jira", options: Object.fromEntries(s.values.map((v) => [v, get(SEL_OPT(s.slot, v))])) };
  }
  return parseSelectMap(raw);
}
/** The rows the database function takes. */
export const selectRows = (m: SelectMap) => Object.entries(m).flatMap(([slot, c]) => (c ? [{ slot, field: c.field, direction: c.direction, options: c.options }] : []));
