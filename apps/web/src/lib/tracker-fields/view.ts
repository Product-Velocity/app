import { MOSCOW_VALUES, type FieldChoice, type Moscow } from "@/lib/atlassian/field-map";
import type { JiraFieldMap } from "@/lib/atlassian/outbound";
import type { Board } from "@pv/github";
import type { CatalogEntry } from "./catalog";
import type { ConfigRow } from "./mapping";
import { defaultOn, mappingRows, type Direction, type Tracker } from "./slots";

// What the field configuration table shows for one project (decision 2026-11-03-tracker-field-config): the default list of Product Velocity fields,
// where each goes, and the person's own setting. Pure; the page supplies what was read from the tracker and what is saved.

export type Control =
  | { type: "toggle"; on: boolean }
  | { type: "select"; value: string; options: { value: string; label: string }[]; blank: string }
  | { type: "priority"; values: Partial<Record<Moscow, string>>; options: FieldChoice[]; proposal: Partial<Record<Moscow, string>> }
  /** Saved by the Project boards card (it reads the board's own fields); shown here so the whole mapping is in one list. */
  | { type: "board"; current: string | null; note: string }
  | { type: "fixed"; reason: string };

export type ChangeRowView = { id: string; key: string; label: string; direction: Direction; target: string; control: Control; isDefault: boolean };
export type StaticRowView = { key: string; label: string; direction: Direction; target: string; reason: string };
export type MappingView = { tracker: Tracker; changeable: ChangeRowView[]; fixed: StaticRowView[]; counts: Record<Direction, number>; unreadable: boolean };

export type MappingInput = {
  tracker: Tracker;
  rows: readonly ConfigRow[];
  /** Jira: the stored field map; its start date, theme and priorities are shown as the rows jira.startDate, jira.theme, jira.focusArea and jira.priority. */
  jiraMap?: JiraFieldMap;
  /** What the tracker offers; null = it could not be read just now (a notice is shown and only the switches can be changed). */
  choices?: { startDates: FieldChoice[]; themes: FieldChoice[]; priorities: FieldChoice[]; dateFields: CatalogEntry[]; proposal: Partial<Record<Moscow, string>> } | null;
  /** GitHub: the linked board of the project, if any. */
  board?: Board | null;
};

const BOARD_KEY = { "github.board.priority": "priority", "github.board.group": "group", "github.board.dueDate": "dueDate", "github.board.size": "size" } as const;

export function buildMappingView(i: MappingInput): MappingView {
  const changeable: ChangeRowView[] = [];
  const fixed: StaticRowView[] = [];
  const counts: Record<Direction, number> = { to_tracker: 0, two_way: 0, from_tracker: 0, not_synced: 0, never: 0 };
  for (const r of mappingRows(i.tracker)) {
    counts[r.direction]++;
    const s = r.slot;
    if (!s || s.kind === "fixed") { fixed.push({ key: r.key, label: r.label, direction: r.direction, target: r.target, reason: r.reason ?? "" }); continue; }
    const saved = i.rows.find((x) => x.slot === s.id);
    const base = { id: s.id, key: r.key, label: r.label, direction: r.direction, target: r.target };
    if (s.kind === "toggle") { const on = saved ? saved.enabled : defaultOn(s); changeable.push({ ...base, control: { type: "toggle", on }, isDefault: on === defaultOn(s) }); continue; }
    if (s.store === "github_board") {
      const ref = i.board?.mapping[BOARD_KEY[s.id as keyof typeof BOARD_KEY]] ?? null;
      changeable.push({ ...base, control: { type: "board", current: i.board ? (ref?.name ?? null) : null, note: i.board ? (ref ? `Uses the board field “${ref.name}”.` : "No board field is chosen: nothing is written.") : "No board is linked to this project." }, isDefault: true });
      continue;
    }
    if (s.id === "jira.priority") {
      const values = i.jiraMap?.priorityByMoscow ?? {};
      changeable.push({ ...base, control: { type: "priority", values, options: i.choices?.priorities ?? [], proposal: i.choices?.proposal ?? {} }, isDefault: MOSCOW_VALUES.every((m) => !values[m]) });
      continue;
    }
    if (s.id === "jira.startDate" || s.id === "jira.theme" || s.id === "jira.focusArea") {
      const value = (s.id === "jira.startDate" ? i.jiraMap?.startDate : s.id === "jira.theme" ? i.jiraMap?.theme : i.jiraMap?.focusArea) ?? "";
      const options = (s.id === "jira.startDate" ? i.choices?.startDates : i.choices?.themes) ?? [];
      changeable.push({ ...base, control: { type: "select", value, blank: "Not mapped (not sent)", options: withCurrent(options, value).map((o) => ({ value: o.id, label: o.name })) }, isDefault: value === "" });
      continue;
    }
    // jira.dueDate: the system due date by default; another date field, or off
    const value = saved ? (saved.enabled ? (saved.field ?? "") : "__off") : "";
    const dates = (i.choices?.dateFields ?? []).filter((d) => d.id !== "duedate");
    changeable.push({ ...base, control: { type: "select", value, blank: "Default: Due date", options: [...withCurrent(dates.map((d) => ({ id: d.id, name: d.name })), saved?.field ?? "").map((o) => ({ value: o.id, label: o.name })), { value: "__off", label: "Don’t send" }] }, isDefault: value === "" });
  }
  return { tracker: i.tracker, changeable, fixed, counts, unreadable: i.choices === null };
}

/** A saved field that the site no longer lists stays selectable (so the page shows what is saved), marked as missing. */
function withCurrent(options: FieldChoice[], current: string): FieldChoice[] {
  return current && !options.some((o) => o.id === current) ? [...options, { id: current, name: `${current} (not found on the site)` }] : options;
}
