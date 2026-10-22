import {
  applyMove, canEditItems, describeEdit, EDITABLE_FIELDS, FIELD_LABEL, LOCKED_FIELDS, projectRanks, UndoStack, validateEdit,
  type Edit, type EditableField, type Entry,
} from "@pv/domain";
import type { PortfolioDataSource } from "./data-source";
import type { GridItem, Lookups } from "./types";

export const READ_ONLY_MESSAGE = "You have view-only access. Ask an admin for the Creator role to edit.";
const NULLABLE: EditableField[] = ["owner_user_id", "moscow", "size", "health", "value", "confidence", "start_date", "end_date"];

export type Status = {
  pending: number;
  error: string | null;
  notice: string | null;
  last: { text: string; at: number } | null;
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  version: number;
};

export type EditOutcome = { ok: true; changed: boolean } | { ok: false; error: string };

const same = (a: unknown, b: unknown) => (a === b) || (a == null && b == null) || (typeof a === "number" && typeof b === "number" && a === b);

/**
 * The brain of the grid, with no UI in it: rows, optimistic edits, background
 * saves, the undo stack and the status line. AG Grid only renders what changes.
 */
export class PortfolioController {
  readonly rows: GridItem[];
  private readonly byId = new Map<string, GridItem>();
  private readonly stack = new UndoStack(20);
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly listeners = new Set<(changed: GridItem[]) => void>();
  private entrySeq = 0;
  private state = { pending: 0, error: null as string | null, notice: null as string | null, last: null as Status["last"], version: 0 };

  constructor(
    private readonly source: PortfolioDataSource,
    items: Omit<GridItem, "project_rank">[],
    private readonly lookups: Lookups,
    private readonly role: string | null,
    private readonly today: () => Date = () => new Date(),
    private readonly now: () => number = () => Date.now(),
  ) {
    this.rows = items.map((i) => ({ ...i, project_rank: 0 }));
    this.rows.sort((a, b) => a.stack_rank - b.stack_rank);
    for (const r of this.rows) this.byId.set(r.id, r);
    this.recomputeProjectRanks();
  }

  get canEdit() { return canEditItems(this.role); }
  get status(): Status {
    return { ...this.state, canUndo: this.stack.canUndo, canRedo: this.stack.canRedo, undoCount: this.stack.undoCount };
  }
  subscribe(fn: (changed: GridItem[]) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  row(id: string) { return this.byId.get(id); }

  private resolvers() {
    return {
      project: (id: string) => this.lookups.projects.find((p) => p.id === id)?.name ?? "unknown project",
      owner: (id: string) => this.lookups.members.find((m) => m.user_id === id)?.email ?? "unknown person",
      today: this.today(),
    };
  }
  private emit(changed: GridItem[] = []) {
    this.state.version++;
    for (const l of this.listeners) l(changed);
  }
  private recomputeProjectRanks(): GridItem[] {
    const ranks = projectRanks(this.rows);
    const changed: GridItem[] = [];
    for (const r of this.rows) {
      const n = ranks.get(r.id) ?? 0;
      if (r.project_rank !== n) { r.project_rank = n; changed.push(r); }
    }
    return changed;
  }

  /** Message under the grid, for example when someone tries to edit a GitHub field. */
  notify(message: string | null) { this.state.notice = message; this.emit(); }
  notifyLocked(field: keyof typeof LOCKED_FIELDS) { this.notify(LOCKED_FIELDS[field]); }
  dismissError() { this.state.error = null; this.emit(); }

  // ---------------------------------------------------------------- edits
  edit(itemId: string, field: EditableField, raw: string): EditOutcome {
    if (!this.canEdit) { this.notify(READ_ONLY_MESSAGE); return { ok: false, error: READ_ONLY_MESSAGE }; }
    const row = this.byId.get(itemId);
    if (!row) return { ok: false, error: "That item no longer exists." };
    if (!EDITABLE_FIELDS.includes(field)) return { ok: false, error: "That field cannot be edited." };
    const v = validateEdit(field, raw, { today: this.today() });
    if (!v.ok) { this.notify(`${row.key} ${FIELD_LABEL[field]}: ${v.error}`); return { ok: false, error: v.error }; }
    const before = row[field];
    if (same(before, v.value)) return { ok: true, changed: false };

    const edit: Edit = { type: "field", itemId, key: row.key, field, before, after: v.value };
    const entry: Entry = { id: `e${++this.entrySeq}`, edits: [edit] };
    this.applyField(row, field, v.value);
    this.stack.push(entry);
    this.state.notice = null;
    this.state.last = { text: describeEdit(edit, this.resolvers()), at: this.now() };
    this.save(entry, `${row.key} ${FIELD_LABEL[field]}`, () => this.source.updateField(itemId, field, v.value), () => {
      // save failed: put the old value back
      const cur = this.byId.get(itemId);
      if (cur && same(cur[field], v.value)) this.applyField(cur, field, before);
    });
    return { ok: true, changed: true };
  }

  /** Delete or Backspace on a cell. */
  clearCell(itemId: string, field: EditableField): EditOutcome {
    if (!NULLABLE.includes(field)) return { ok: false, error: `${FIELD_LABEL[field]} cannot be empty.` };
    return this.edit(itemId, field, "");
  }

  editRank(itemId: string, raw: string): EditOutcome {
    if (!this.canEdit) { this.notify(READ_ONLY_MESSAGE); return { ok: false, error: READ_ONLY_MESSAGE }; }
    const row = this.byId.get(itemId);
    if (!row) return { ok: false, error: "That item no longer exists." };
    const n = /^\s*#?\d+\s*$/.test(raw) ? Number(raw.replace("#", "")) : NaN;
    if (!Number.isInteger(n) || n < 1) {
      const error = "Enter a rank as a whole number, 1 or higher.";
      this.notify(`${row.key} rank: ${error}`);
      return { ok: false, error };
    }
    return this.move(itemId, n);
  }

  private move(itemId: string, to: number): EditOutcome {
    const row = this.byId.get(itemId)!;
    const before = row.stack_rank;
    const r = applyMove(this.rows, itemId, to);
    if (!r.changed) return { ok: true, changed: false };
    const edit: Edit = { type: "rank", itemId, key: row.key, before, after: r.to };
    const entry: Entry = { id: `e${++this.entrySeq}`, edits: [edit] };
    const moved = this.applyRanks(r.items);
    this.stack.push(entry);
    this.state.notice = null;
    this.state.last = { text: describeEdit(edit, this.resolvers()), at: this.now() };
    this.save(entry, `${row.key} rank`, () => this.source.moveItem(itemId, r.to), () => {
      const back = applyMove(this.rows, itemId, before);
      this.applyRanks(back.items);
    });
    this.emit(moved);
    return { ok: true, changed: true };
  }

  private applyRanks(sorted: GridItem[]): GridItem[] {
    const changed: GridItem[] = [];
    for (const s of sorted) {
      const r = this.byId.get(s.id)!;
      if (r.stack_rank !== s.stack_rank) { r.stack_rank = s.stack_rank; changed.push(r); }
    }
    this.rows.sort((a, b) => a.stack_rank - b.stack_rank);
    for (const c of this.recomputeProjectRanks()) if (!changed.includes(c)) changed.push(c);
    return changed;
  }

  private applyField(row: GridItem, field: EditableField, value: unknown) {
    (row as Record<string, unknown>)[field] = value;
    const changed = [row];
    if (field === "home_project_id") for (const c of this.recomputeProjectRanks()) if (c !== row) changed.push(c);
    this.emit(changed);
  }

  // ---------------------------------------------------------------- saving
  /** Saves for the same cell go one after the other, so the last edit always wins. */
  private save(entry: Entry | null, label: string, run: () => Promise<{ ok: boolean; error?: string }>, revert: () => void, onDone?: (ok: boolean) => void) {
    const edit = entry?.edits[0];
    const queueKey = edit ? `${edit.itemId}:${edit.type === "field" ? edit.field : "rank"}` : "misc";
    this.state.pending++;
    this.emit();
    const prev = this.queues.get(queueKey) ?? Promise.resolve();
    const next = prev.then(run).catch((e) => ({ ok: false as const, error: String(e?.message ?? e) })).then((res) => {
      this.state.pending--;
      if (res.ok) {
        this.state.error = null;
        onDone?.(true);
        this.emit();
      } else {
        revert();
        if (entry) this.stack.discard(entry);
        this.state.error = `Could not save ${label}: ${res.error ?? "unknown error"}. The change was reverted.`;
        onDone?.(false);
        this.emit();
      }
    });
    this.queues.set(queueKey, next);
    void next.finally(() => { if (this.queues.get(queueKey) === next) this.queues.delete(queueKey); });
  }

  /** Resolves when every save so far has finished (tests and page unload). */
  async flush() { while (this.state.pending > 0) await Promise.all([...this.queues.values()]); }

  // ------------------------------------------------------------ undo / redo
  undo() { return this.replay("undo"); }
  redo() { return this.replay("redo"); }

  private async replay(direction: "undo" | "redo") {
    if (!this.canEdit) { this.notify(READ_ONLY_MESSAGE); return; }
    const entry = direction === "undo" ? this.stack.undo() : this.stack.redo();
    if (!entry) return;
    const restore = () => (direction === "undo" ? this.stack.restoreUndo(entry) : this.stack.restoreRedo(entry));
    const shown = (e: Edit): Edit =>
      direction === "undo" ? ({ ...e, before: e.after, after: e.before } as Edit) : e;
    // newest edit first when undoing
    const edits = direction === "undo" ? [...entry.edits].reverse() : entry.edits;
    for (const edit of edits) {
      const row = this.byId.get(edit.itemId);
      const target = direction === "undo" ? edit.before : edit.after;
      const expected = direction === "undo" ? edit.after : edit.before;
      const verb = direction === "undo" ? "Undid" : "Redid";
      if (!row) { this.state.error = `Could not ${direction}: ${edit.key} no longer exists.`; this.emit(); restore(); return; }
      if (edit.type === "rank") {
        if (row.stack_rank !== expected) {
          this.state.error = `Could not ${direction} the move of ${edit.key}: its rank changed in the meantime.`;
          this.emit(); restore(); return;
        }
        const r = applyMove(this.rows, edit.itemId, target as number);
        const changed = this.applyRanks(r.items);
        this.state.last = { text: `${verb}: ${describeEdit(shown(edit), this.resolvers())}`, at: this.now() };
        this.emit(changed);
        await this.runReplaySave(`${edit.key} rank`, () => this.source.moveItem(edit.itemId, target as number), () => {
          this.applyRanks(applyMove(this.rows, edit.itemId, expected as number).items);
        }, restore);
      } else {
        if (!same(row[edit.field], expected)) {
          this.state.error = `Could not ${direction} ${edit.key} ${FIELD_LABEL[edit.field]}: it was changed in the meantime.`;
          this.emit(); restore(); return;
        }
        this.applyField(row, edit.field, target);
        this.state.last = { text: `${verb}: ${describeEdit(shown(edit), this.resolvers())}`, at: this.now() };
        this.emit([row]);
        await this.runReplaySave(`${edit.key} ${FIELD_LABEL[edit.field]}`, () => this.source.updateField(edit.itemId, edit.field, target, { expected }), () => {
          const cur = this.byId.get(edit.itemId);
          if (cur) this.applyField(cur, edit.field, expected);
        }, restore);
      }
    }
  }

  private runReplaySave(label: string, run: () => Promise<{ ok: boolean; error?: string }>, revert: () => void, restore: () => void) {
    return new Promise<void>((resolve) => {
      this.save(null, label, run, revert, (ok) => { if (!ok) restore(); resolve(); });
    });
  }
}
