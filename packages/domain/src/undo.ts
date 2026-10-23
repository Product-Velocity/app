import { formatDate } from "./dates";
import { fieldLabel, type EditableField } from "./fields";
import { FIELD_BY_KEY } from "./registry";
import { formatValue } from "./money";

export type FieldEdit = { type: "field"; itemId: string; key: string; field: EditableField; before: unknown; after: unknown };
export type RankEdit = { type: "rank"; itemId: string; key: string; before: number; after: number };
/** An item added by quick-add. Undo deletes it; redo adds it again (it then gets a new code at the end of the list). */
export type CreateEdit = {
  type: "create"; itemId: string; key: string;
  draft: NewItemValues;
};
/** Field values of a new item by dictionary key; a name and a project are always there. */
export type NewItemValues = Record<string, unknown> & { initiative_name: string; home_project: string };
/** A list field of an item (tags, links, relations, teams) replaced as a whole; undo puts the old list back. */
export type RelatedEdit = { type: "related"; itemId: string; key: string; field: string; before: unknown[]; after: unknown[] };
/** An item moved to the Trash. Undo brings it back at its old rank; redo deletes it again. `row` is what the grid showed. */
export type DeleteEdit = { type: "delete"; itemId: string; key: string; name: string; rank: number; row: Record<string, unknown> };
export type Edit = FieldEdit | RankEdit | CreateEdit | RelatedEdit | DeleteEdit;
/** One undo step. A bulk action is one entry with several edits. */
export type Entry = { id: string; edits: Edit[]; /** Shown after undo and redo of a batch, for example "Set Effort on 3 items". */ label?: string };

export class UndoStack {
  private undoList: Entry[] = [];
  private redoList: Entry[] = [];
  constructor(private readonly limit = 20) {}

  get undoCount() { return this.undoList.length; }
  get canUndo() { return this.undoList.length > 0; }
  get canRedo() { return this.redoList.length > 0; }

  push(entry: Entry) {
    this.undoList.push(entry);
    if (this.undoList.length > this.limit) this.undoList.shift();
    this.redoList = [];
  }
  /** A change that could not be saved: forget it. */
  discard(e: Entry) {
    const i = this.undoList.lastIndexOf(e);
    if (i >= 0) this.undoList.splice(i, 1);
  }
  /** Take the newest change off for undoing; it moves to the redo list. */
  undo(): Entry | null {
    const e = this.undoList.pop() ?? null;
    if (e) this.redoList.push(e);
    return e;
  }
  redo(): Entry | null {
    const e = this.redoList.pop() ?? null;
    if (e) this.undoList.push(e);
    return e;
  }
  /** Undo could not be applied: put the entry back where it was. */
  restoreUndo(e: Entry) {
    const i = this.redoList.lastIndexOf(e);
    if (i >= 0) this.redoList.splice(i, 1);
    this.undoList.push(e);
  }
  restoreRedo(e: Entry) {
    const i = this.undoList.lastIndexOf(e);
    if (i >= 0) this.undoList.splice(i, 1);
    this.redoList.push(e);
  }
  clear() { this.undoList = []; this.redoList = []; }
}

export type Resolvers = { project: (id: string) => string; owner: (id: string) => string; today?: Date };

function show(field: EditableField, v: unknown, r: Resolvers): string {
  if (v === null || v === undefined || v === "") return "empty";
  const f = FIELD_BY_KEY[field];
  if (field === "home_project") return r.project(String(v));
  if (f?.type === "Person") return r.owner(String(v));
  if (f?.type === "Currency") return formatValue(Number(v));
  if (f?.type === "Date") return formatDate(String(v), r.today ?? new Date());
  if (f?.type === "Boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return Object.entries(v as Record<string, unknown>).map(([k, n]) => `${k} ${n}`).join(", ");
  return String(v);
}

/** "R-41 Health: On track to At risk": shown in the status strip after every change. */
export function describeEdit(edit: Edit, r: Resolvers): string {
  if (edit.type === "delete") return `Deleted ${edit.key} "${edit.name}"`;
  if (edit.type === "create") return `Added ${edit.key === "…" ? "" : `${edit.key} `}"${edit.draft.initiative_name}"`;
  if (edit.type === "related") return `${edit.key} ${fieldLabel(edit.field)}: ${describeListChange(edit.before, edit.after)}`;
  if (edit.type === "rank") return `${edit.key} moved from rank ${edit.before} to ${edit.after}`;
  return `${edit.key} ${fieldLabel(edit.field)}: ${show(edit.field, edit.before, r)} to ${show(edit.field, edit.after, r)}`;
}

const itemText = (v: unknown): string => (v && typeof v === "object" ? String((v as { label?: string; url?: string }).label || (v as { url?: string }).url || "") : String(v));
const itemKey = (v: unknown): string => (v && typeof v === "object" ? JSON.stringify(v) : String(v));
/** "added urgent, removed a" for a list that went from `before` to `after`. */
export function describeListChange(before: readonly unknown[], after: readonly unknown[]): string {
  const b = new Set(before.map(itemKey)), a = new Set(after.map(itemKey));
  const added = after.filter((x) => !b.has(itemKey(x))).map(itemText);
  const removed = before.filter((x) => !a.has(itemKey(x))).map(itemText);
  return [added.length ? `added ${added.join(", ")}` : "", removed.length ? `removed ${removed.join(", ")}` : ""].filter(Boolean).join(", ") || "no change";
}
