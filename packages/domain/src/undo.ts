import { formatDate } from "./dates";
import { FIELD_LABEL, optionLabel, type EditableField } from "./fields";
import { formatValue } from "./money";

export type FieldEdit = { type: "field"; itemId: string; key: string; field: EditableField; before: unknown; after: unknown };
export type RankEdit = { type: "rank"; itemId: string; key: string; before: number; after: number };
export type Edit = FieldEdit | RankEdit;
/** One undo step. A bulk action is one entry with several edits. */
export type Entry = { id: string; edits: Edit[] };

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
  switch (field) {
    case "moscow": case "size": case "health": return optionLabel(field, String(v));
    case "value": return formatValue(Number(v));
    case "start_date": case "end_date": return formatDate(String(v), r.today ?? new Date());
    case "home_project_id": return r.project(String(v));
    case "owner_user_id": return r.owner(String(v));
    case "confidence": return `${v}%`;
    default: return String(v);
  }
}

/** "R-41 Health: On track to At risk": shown in the status strip after every change. */
export function describeEdit(edit: Edit, r: Resolvers): string {
  if (edit.type === "rank") return `${edit.key} moved from rank ${edit.before} to ${edit.after}`;
  return `${edit.key} ${FIELD_LABEL[edit.field]}: ${show(edit.field, edit.before, r)} to ${show(edit.field, edit.after, r)}`;
}
