import { MOSCOW_VALUES, type FieldChoice, type Moscow } from "@/lib/atlassian/field-map";
import type { JiraFieldMap } from "@/lib/atlassian/outbound";
import type { Board } from "@pv/github";
import type { CatalogEntry } from "./catalog";
import type { ConfigRow } from "./mapping";
import { defaultText } from "./mapping";
import { defaultOn, mappingRows, slotsFor, type Direction, type Tracker } from "./slots";

// What the field configuration table shows for one project (decision 2026-11-03-tracker-field-config): the default list of Product Velocity fields,
// where each goes, and the person's own setting. Pure; the page supplies what was read from the tracker and what is saved.

export type Control =
  /** `text` (stealth mode): the name a label row can be given, the saved one ("" = the default) and the default. */
  | { type: "toggle"; on: boolean; text?: { value: string; default: string } }
  | { type: "select"; value: string; options: { value: string; label: string }[]; blank: string }
  | { type: "priority"; values: Partial<Record<Moscow, string>>; options: FieldChoice[]; proposal: Partial<Record<Moscow, string>> }
  /** Saved by the Project boards card (it reads the board's own fields); shown here so the whole mapping is in one list. */
  | { type: "board"; current: string | null; note: string }
  | { type: "fixed"; reason: string };

export type ChangeRowView = { id: string; key: string; label: string; direction: Direction; target: string; control: Control; isDefault: boolean };
export type StaticRowView = { key: string; label: string; direction: Direction; target: string; reason: string };
/** The names card (stealth mode, issue #411): things that are not Product Velocity fields but still say "Product Velocity" in the tracker. */
export type NameRowView = { id: string; label: string; help: string; /** a switch ("Add it") with a text, a text, or only a switch */ type: "toggle-text" | "text" | "flag"; on: boolean; value: string; default: string };
export type MappingView = { tracker: Tracker; changeable: ChangeRowView[]; fixed: StaticRowView[]; names: NameRowView[]; counts: Record<Direction, number>; unreadable: boolean };

const NAME_TEXT: Record<string, { label: string; help: string }> = {
  "label.base": { label: "Base label", help: "Put on every issue Product Velocity writes. Switch it off to send none." },
  "name.removed": { label: "Removed label", help: "Added when you confirm closing the issue of a removed initiative. It is never taken off again." },
  "name.define": { label: "Define label", help: "On the issue while the initiative is in Define, for engineering feedback." },
  "name.marker": { label: "Hidden item label", help: "Ends in a slash, then a code. Finds an issue again when Jira's answer to a create was lost." },
  "name.block": { label: "Marker word", help: "The word inside the hidden comments around the managed block of the issue body (<!-- word:begin -->)." },
};

export type MappingInput = {
  tracker: Tracker;
  rows: readonly ConfigRow[];
  /** Jira: the stored field map; its start date, theme and priorities are shown as the rows jira.startDate, jira.theme and jira.priority. */
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
    if (s.kind === "toggle") { const on = saved ? saved.enabled : defaultOn(s); changeable.push({ ...base, control: { type: "toggle", on, ...(s.nameKind ? { text: { value: saved?.text ?? "", default: defaultText(s) } } : {}) }, isDefault: on === defaultOn(s) && !saved?.text }); continue; }
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
    if (s.id === "jira.startDate" || s.id === "jira.theme") {
      const value = (s.id === "jira.startDate" ? i.jiraMap?.startDate : i.jiraMap?.theme) ?? "";
      const options = (s.id === "jira.startDate" ? i.choices?.startDates : i.choices?.themes) ?? [];
      changeable.push({ ...base, control: { type: "select", value, blank: "Not mapped (not sent)", options: withCurrent(options, value).map((o) => ({ value: o.id, label: o.name })) }, isDefault: value === "" });
      continue;
    }
    // jira.dueDate: the system due date by default; another date field, or off
    const value = saved ? (saved.enabled ? (saved.field ?? "") : "__off") : "";
    const dates = (i.choices?.dateFields ?? []).filter((d) => d.id !== "duedate");
    changeable.push({ ...base, control: { type: "select", value, blank: "Default: Due date", options: [...withCurrent(dates.map((d) => ({ id: d.id, name: d.name })), saved?.field ?? "").map((o) => ({ value: o.id, label: o.name })), { value: "__off", label: "Don’t send" }] }, isDefault: value === "" });
  }
  const names: NameRowView[] = [];
  for (const s of slotsFor(i.tracker).filter((x) => x.pvKey === "")) {
    const saved = i.rows.find((x) => x.slot === s.id);
    if (s.id.endsWith(".hideBrand")) { names.push({ id: s.id, label: "Hide the Product Velocity name", help: "Leaves the name and the link back to the app out of the issue footer, and the description off the labels and milestones it creates.", type: "flag", on: saved ? saved.enabled : false, value: "", default: "" }); continue; }
    const t = NAME_TEXT[s.id.split(".").slice(1).join(".")];
    if (!t) continue;
    names.push({ id: s.id, label: t.label, help: t.help, type: s.kind === "name" ? "text" : "toggle-text", on: saved ? saved.enabled : defaultOn(s), value: saved?.text ?? "", default: defaultText(s) });
  }
  return { tracker: i.tracker, changeable, fixed, names, counts, unreadable: i.choices === null };
}

/** A saved field that the site no longer lists stays selectable (so the page shows what is saved), marked as missing. */
function withCurrent(options: FieldChoice[], current: string): FieldChoice[] {
  return current && !options.some((o) => o.id === current) ? [...options, { id: current, name: `${current} (not found on the site)` }] : options;
}
