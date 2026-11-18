import { FIELD_BY_KEY } from "@pv/domain";
import { BOARD_SELECTS, parseSelects, type BoardField, type BoardMapping } from "@pv/github";

// The form of the "Initiative fields" card of a GitHub project (issue #513, the twin of the Jira card): per slot a board field, a direction and one
// board option for each Product Velocity value. "" always means "not mapped". Pure, so the form is tested without a browser.
export const BSEL_FIELD = (key: string) => `bselfield:${key}`;
export const BSEL_DIR = (key: string) => `bseldir:${key}`;
export const BSEL_OPT = (key: string, value: string) => `bselopt:${key}:${value}`;
export const valuesOf = (key: string): readonly string[] => FIELD_BY_KEY[key]?.allowed ?? [];

/** The mapping from the form. A board field is chosen by its id; options by their NAME (the board's own spelling). */
export function boardSelectsFromForm(get: (name: string) => string, fields: readonly BoardField[]): BoardMapping["selects"] | undefined {
  const raw: Record<string, unknown> = {};
  for (const s of BOARD_SELECTS) {
    const id = get(BSEL_FIELD(s.key));
    const f = fields.find((x) => x.id === id);
    if (!id || !f) continue;
    raw[s.key] = { field: { id: f.id, name: f.name }, direction: get(BSEL_DIR(s.key)) || "to_github", options: Object.fromEntries(valuesOf(s.key).flatMap((v) => (get(BSEL_OPT(s.key, v)) ? [[v, get(BSEL_OPT(s.key, v))]] : []))) };
  }
  return parseSelects(raw);
}

/** What a person can still fix: the field must be a single select of this board, each option one of its options, one board field for one slot. */
export function validateBoardSelects(selects: BoardMapping["selects"] | undefined, fields: readonly BoardField[], taken: readonly string[] = []): string[] {
  const errors: string[] = [];
  const used = new Set<string>(taken);
  for (const s of BOARD_SELECTS) {
    const c = selects?.[s.key];
    if (!c) continue;
    const f = fields.find((x) => x.id === c.field.id);
    if (!f || f.dataType !== "SINGLE_SELECT") { errors.push(`${s.label}: “${c.field.name}” is not a single-select field of this board.`); continue; }
    if (used.has(f.id)) errors.push(`${s.label}: the board field “${f.name}” is already used by another setting.`);
    used.add(f.id);
    for (const [value, name] of Object.entries(c.options)) if (!f.options?.some((o) => o.name.trim().toLowerCase() === name.trim().toLowerCase())) errors.push(`${s.label}: the board field “${f.name}” has no option “${name}” (chosen for ${value}).`);
  }
  return errors;
}
