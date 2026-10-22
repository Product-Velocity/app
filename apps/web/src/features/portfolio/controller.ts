import {
  applyMove, canBeEmpty, canEditItems, describeEdit, EDITABLE_FIELDS, fieldLabel, localToday, projectRanks, readOnlyReason, UndoStack, validateEdit,
  bulkEditReason, type Edit, type EditableField, type Entry, type NewItemValues,
} from "@pv/domain";
import type { PortfolioDataSource } from "./data-source";
import type { GridItem, Lookups, LoadedItem } from "./types";

export const READ_ONLY_MESSAGE = "You have view-only access. Ask an admin for the Creator role to edit.";

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
  private readonly focusListeners = new Set<(id: string) => void>();
  private readonly structureListeners = new Set<(add: GridItem[], remove: GridItem[]) => void>();
  private entrySeq = 0;
  private state = { pending: 0, error: null as string | null, notice: null as string | null, last: null as Status["last"], version: 0 };

  constructor(
    private readonly source: PortfolioDataSource,
    items: LoadedItem[],
    private readonly lookups: Lookups,
    private readonly role: string | null,
    private readonly today: () => Date = () => localToday(),
    private readonly now: () => number = () => Date.now(),
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {
    this.rows = items.map((i) => ({ ...i, project_rank: 0 }));
    this.rows.sort((a, b) => a.stack_rank - b.stack_rank);
    for (const r of this.rows) this.byId.set(r.id, r);
    this.recomputeProjectRanks();
  }

  /** "Today" as the grid sees it (a fixed day on the test page). */
  todayDate() { return this.today(); }
  get canEdit() { return canEditItems(this.role); }
  get status(): Status {
    return { ...this.state, canUndo: this.stack.canUndo, canRedo: this.stack.canRedo, undoCount: this.stack.undoCount };
  }
  subscribe(fn: (changed: GridItem[]) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  /** The grid keeps the keyboard focus on a row whose rank changed (it jumps to its new place). */
  onFocusRequest(fn: (id: string) => void) { this.focusListeners.add(fn); return () => { this.focusListeners.delete(fn); }; }
  /** The grid adds and removes rows when items are added or taken away again (undo). */
  onStructure(fn: (add: GridItem[], remove: GridItem[]) => void) { this.structureListeners.add(fn); return () => { this.structureListeners.delete(fn); }; }
  private requestFocus(id: string) { for (const f of this.focusListeners) f(id); }
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
  /** Explain why a cell cannot be edited (GitHub-driven, calculated, set by the system, or from a later phase). */
  notifyReadOnly(field: string) { const why = readOnlyReason(field); if (why) this.notify(why); }
  dismissError() { this.state.error = null; this.emit(); }

  // ---------------------------------------------------------------- adding
  private buildRow(id: string, d: NewItemValues, code = "…", rank = 0): GridItem {
    return { visibility: "Internal only", archived: false, date_precision: "Day", ...d, id, item_code: code, stack_rank: rank, project_rank: 0 } as GridItem;
  }
  private addRows(added: GridItem[]) {
    for (const r of added) { this.rows.push(r); this.byId.set(r.id, r); }
    this.rows.sort((a, b) => a.stack_rank - b.stack_rank);
    const moved = this.recomputeProjectRanks();
    for (const l of this.structureListeners) l(added, []);
    this.emit(moved.filter((m) => !added.includes(m)));
  }
  private removeRows(removed: GridItem[]) {
    for (const r of removed) { this.byId.delete(r.id); const i = this.rows.indexOf(r); if (i >= 0) this.rows.splice(i, 1); }
    // close the gaps, as the database does after a delete
    const changed: GridItem[] = [];
    this.rows.sort((a, b) => a.stack_rank - b.stack_rank).forEach((r, i) => { if (r.stack_rank !== i + 1) { r.stack_rank = i + 1; changed.push(r); } });
    for (const c of this.recomputeProjectRanks()) if (!changed.includes(c)) changed.push(c);
    for (const l of this.structureListeners) l([], removed);
    this.emit(changed);
  }
  private adopt(row: GridItem, r: { item_code: string; stack_rank: number }) {
    row.item_code = r.item_code;
    if (row.stack_rank !== r.stack_rank) { row.stack_rank = r.stack_rank; this.rows.sort((a, b) => a.stack_rank - b.stack_rank); this.recomputeProjectRanks(); }
    this.emit([row]);
  }

  /**
   * Quick-add and import: the items show at the end of the list at once and are saved in ONE request (all or nothing).
   * One undo step for the whole batch.
   */
  createItems(drafts: NewItemValues[], opts: { via?: "import"; label?: string } = {}): { ok: true; created: number } | { ok: false; error: string } {
    if (!this.canEdit) { this.notify(READ_ONLY_MESSAGE); return { ok: false, error: READ_ONLY_MESSAGE }; }
    if (drafts.length === 0) return { ok: true, created: 0 };
    let rank = this.rows.reduce((n, r) => Math.max(n, r.stack_rank), 0);
    const added = drafts.map((d) => this.buildRow(this.newId(), d, "…", ++rank));
    const edits = added.map((row, i): Edit => ({ type: "create", itemId: row.id, key: "…", draft: drafts[i]! }));
    const label = opts.label ?? (added.length === 1 ? undefined : `Added ${added.length} items`);
    const entry: Entry = { id: `e${++this.entrySeq}`, edits, ...(label ? { label } : {}) };
    this.stack.push(entry);
    this.state.notice = null;
    this.state.last = { text: label ?? describeEdit(edits[0]!, this.resolvers()), at: this.now() };
    this.addRows(added);
    let result: { id: string; item_code: string; stack_rank: number }[] = [];
    const what = added.length === 1 ? `"${added[0]!.initiative_name}"` : `${added.length} items`;
    this.save(null, what, async () => {
      const r = await this.source.createMany(added.map((row, i) => ({ id: row.id, ...drafts[i]! })), opts.via ? { via: opts.via } : {});
      if (r.ok) result = r.items;
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    }, () => {
      this.removeRows(added.filter((x) => this.byId.has(x.id)));
      this.stack.discard(entry);
    }, (ok) => {
      if (!ok) return;
      for (const s of result) {
        const row = this.byId.get(s.id);
        const edit = edits.find((e) => e.itemId === s.id);
        if (edit) edit.key = s.item_code;
        if (row) this.adopt(row, s);
      }
    }, "Could not add");
    return { ok: true, created: added.length };
  }

  /** Set one field on many rows: one validation, one undo step, one saved change per row (each audited by the database). */
  bulkEdit(itemIds: string[], field: string, raw: string): { ok: true; changed: number; unchanged: number } | { ok: false; error: string } {
    if (!this.canEdit) { this.notify(READ_ONLY_MESSAGE); return { ok: false, error: READ_ONLY_MESSAGE }; }
    const reason = bulkEditReason(field);
    if (reason || !EDITABLE_FIELDS.includes(field)) {
      const error = reason ?? "That field cannot be edited.";
      this.notify(error);
      return { ok: false, error };
    }
    const v = validateEdit(field, raw, { today: this.today() });
    if (!v.ok) { this.notify(`${fieldLabel(field)}: ${v.error}`); return { ok: false, error: v.error }; }
    const rows = itemIds.map((id) => this.byId.get(id)).filter((r): r is GridItem => !!r);
    const todo = rows.filter((r) => !same(r[field], v.value));
    const unchanged = rows.length - todo.length;
    if (todo.length === 0) return { ok: true, changed: 0, unchanged };

    const edits = todo.map((row): Edit => ({ type: "field", itemId: row.id, key: row.item_code, field, before: row[field], after: v.value }));
    const shownValue = describeEdit({ ...edits[0]!, before: null } as Edit, this.resolvers()).split(": empty to ")[1] ?? String(v.value);
    const label = `Set ${fieldLabel(field)} on ${todo.length} ${todo.length === 1 ? "item" : "items"}`;
    const entry: Entry = { id: `e${++this.entrySeq}`, edits, label };
    this.stack.push(entry);
    this.state.notice = null;
    this.state.last = { text: v.value === null ? `Cleared ${fieldLabel(field)} on ${todo.length} ${todo.length === 1 ? "item" : "items"}` : `Set ${fieldLabel(field)} to ${shownValue} on ${todo.length} ${todo.length === 1 ? "item" : "items"}`, at: this.now() };
    todo.forEach((row, i) => {
      const edit = edits[i]!;
      this.applyField(row, field, v.value);
      this.save(null, `${row.item_code} ${fieldLabel(field)}`, () => this.source.updateField(row.id, field, v.value), () => {
        const cur = this.byId.get(row.id);
        if (cur && same(cur[field], v.value)) this.applyField(cur, field, (edit as { before: unknown }).before);
        const at = entry.edits.indexOf(edit);
        if (at >= 0) entry.edits.splice(at, 1);
        if (entry.edits.length === 0) this.stack.discard(entry);
      }, undefined, "Could not save", `${row.id}:${field}`);
    });
    this.emit(todo);
    return { ok: true, changed: todo.length, unchanged };
  }

  // ---------------------------------------------------------------- edits
  edit(itemId: string, field: EditableField, raw: string): EditOutcome {
    if (!this.canEdit) { this.notify(READ_ONLY_MESSAGE); return { ok: false, error: READ_ONLY_MESSAGE }; }
    const row = this.byId.get(itemId);
    if (!row) return { ok: false, error: "That item no longer exists." };
    if (!EDITABLE_FIELDS.includes(field)) {
      const error = readOnlyReason(field) ?? "That field cannot be edited.";
      this.notify(error);
      return { ok: false, error };
    }
    const v = validateEdit(field, raw, { today: this.today() });
    if (!v.ok) { this.notify(`${row.item_code} ${fieldLabel(field)}: ${v.error}`); return { ok: false, error: v.error }; }
    const before = row[field];
    if (same(before, v.value)) return { ok: true, changed: false };

    const edit: Edit = { type: "field", itemId, key: row.item_code, field, before, after: v.value };
    const entry: Entry = { id: `e${++this.entrySeq}`, edits: [edit] };
    this.applyField(row, field, v.value);
    this.stack.push(entry);
    this.state.notice = null;
    this.state.last = { text: describeEdit(edit, this.resolvers()), at: this.now() };
    this.save(entry, `${row.item_code} ${fieldLabel(field)}`, () => this.source.updateField(itemId, field, v.value), () => {
      // save failed: put the old value back
      const cur = this.byId.get(itemId);
      if (cur && same(cur[field], v.value)) this.applyField(cur, field, before);
    });
    return { ok: true, changed: true };
  }

  /** Delete or Backspace on a cell. */
  clearCell(itemId: string, field: EditableField): EditOutcome {
    if (!canBeEmpty(field)) return { ok: false, error: `${fieldLabel(field)} cannot be empty.` };
    return this.edit(itemId, field, "");
  }

  editRank(itemId: string, raw: string): EditOutcome {
    if (!this.canEdit) { this.notify(READ_ONLY_MESSAGE); return { ok: false, error: READ_ONLY_MESSAGE }; }
    const row = this.byId.get(itemId);
    if (!row) return { ok: false, error: "That item no longer exists." };
    const n = /^\s*#?\d+\s*$/.test(raw) ? Number(raw.replace("#", "")) : NaN;
    if (!Number.isInteger(n) || n < 1) {
      const error = "Enter a rank as a whole number, 1 or higher.";
      this.notify(`${row.item_code} rank: ${error}`);
      return { ok: false, error };
    }
    return this.move(itemId, n);
  }

  private move(itemId: string, to: number): EditOutcome {
    const row = this.byId.get(itemId)!;
    const before = row.stack_rank;
    const r = applyMove(this.rows, itemId, to);
    if (!r.changed) return { ok: true, changed: false };
    const edit: Edit = { type: "rank", itemId, key: row.item_code, before, after: r.to };
    const entry: Entry = { id: `e${++this.entrySeq}`, edits: [edit] };
    const moved = this.applyRanks(r.items);
    this.stack.push(entry);
    this.state.notice = null;
    this.state.last = { text: describeEdit(edit, this.resolvers()), at: this.now() };
    this.save(entry, `${row.item_code} rank`, () => this.source.moveItem(itemId, r.to), () => {
      const back = applyMove(this.rows, itemId, before);
      this.applyRanks(back.items);
    });
    this.emit(moved);
    this.requestFocus(itemId);
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
    if (field === "home_project") for (const c of this.recomputeProjectRanks()) if (c !== row) changed.push(c);
    this.emit(changed);
  }

  // ---------------------------------------------------------------- saving
  /** Saves for the same cell go one after the other, so the last edit always wins. */
  private save(entry: Entry | null, label: string, run: () => Promise<{ ok: boolean; error?: string }>, revert: () => void, onDone?: (ok: boolean) => void, failVerb = "Could not save", queueKeyOverride?: string) {
    const edit = entry?.edits[0];
    const queueKey = queueKeyOverride ?? (edit ? `${edit.itemId}:${edit.type === "field" ? edit.field : "rank"}` : "misc");
    this.state.pending++;
    this.emit();
    const prev = this.queues.get(queueKey) ?? Promise.resolve();
    const next = prev.then(run).catch((e) => ({ ok: false as const, error: String(e?.message ?? e) })).then((res) => {
      this.state.pending--;
      if (res.ok) {
        if (!queueKeyOverride) this.state.error = null; // saves of a bulk edit must not hide a failure of a sibling row
        onDone?.(true);
        this.emit();
      } else {
        revert();
        if (entry) this.stack.discard(entry);
        this.state.error = `${failVerb} ${label}: ${res.error ?? "unknown error"}. The change was reverted.`;
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
      direction === "undo" && e.type !== "create" ? ({ ...e, before: e.after, after: e.before } as Edit) : e;
    if (entry.edits.length > 0 && entry.edits.every((e) => e.type === "create")) {
      await this.replayCreates(entry, entry.edits as Extract<Edit, { type: "create" }>[], direction, restore);
      return;
    }
    // newest edit first when undoing
    const edits = direction === "undo" ? [...entry.edits].reverse() : entry.edits;
    for (const edit of edits) {
      if (edit.type === "create") continue; // never mixed with other edits

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
        this.requestFocus(edit.itemId);
        await this.runReplaySave(`${edit.key} rank`, () => this.source.moveItem(edit.itemId, target as number), () => {
          this.applyRanks(applyMove(this.rows, edit.itemId, expected as number).items);
        }, restore);
      } else {
        if (!same(row[edit.field], expected)) {
          this.state.error = `Could not ${direction} ${edit.key} ${fieldLabel(edit.field)}: it was changed in the meantime.`;
          this.emit(); restore(); return;
        }
        this.applyField(row, edit.field, target);
        this.state.last = { text: `${verb}: ${describeEdit(shown(edit), this.resolvers())}`, at: this.now() };
        this.emit([row]);
        await this.runReplaySave(`${edit.key} ${fieldLabel(edit.field)}`, () => this.source.updateField(edit.itemId, edit.field, target, { expected }), () => {
          const cur = this.byId.get(edit.itemId);
          if (cur) this.applyField(cur, edit.field, expected);
        }, restore);
      }
    }
    if (entry.label && entry.edits.length > 1) {
      this.state.last = { text: `${direction === "undo" ? "Undid" : "Redid"}: ${entry.label}`, at: this.now() };
      this.emit();
    }
  }

  /** Undo deletes the whole batch in one request; redo adds it back at the end (new codes). */
  private async replayCreates(entry: Entry, edits: Extract<Edit, { type: "create" }>[], direction: "undo" | "redo", restore: () => void) {
    const text = entry.label ?? describeEdit(edits[0]!, this.resolvers());
    if (direction === "undo") {
      const rows = edits.map((e) => this.byId.get(e.itemId)).filter((r): r is GridItem => !!r);
      if (rows.length === 0) { this.state.error = "Could not undo: those items no longer exist."; this.emit(); restore(); return; }
      this.removeRows(rows);
      this.state.last = { text: `Undid: ${text}`, at: this.now() };
      this.emit();
      await this.runReplaySave("removing the added items", () => this.source.deleteItems(rows.map((r) => r.id)), () => this.addRows(rows), restore);
      return;
    }
    let rank = this.rows.reduce((n, r) => Math.max(n, r.stack_rank), 0);
    const rows = edits.map((e) => this.buildRow(e.itemId, e.draft, "…", ++rank));
    this.addRows(rows);
    this.state.last = { text: `Redid: ${text}`, at: this.now() };
    this.emit();
    await this.runReplaySave("adding the items again", async () => {
      const r = await this.source.createMany(rows.map((row, i) => ({ id: row.id, ...edits[i]!.draft })));
      if (!r.ok) return { ok: false, error: r.error };
      for (const s of r.items) {
        const row = this.byId.get(s.id);
        const edit = edits.find((e) => e.itemId === s.id);
        if (edit) edit.key = s.item_code;
        if (row) this.adopt(row, s);
      }
      return { ok: true };
    }, () => this.removeRows(rows), restore);
  }

  private runReplaySave(label: string, run: () => Promise<{ ok: boolean; error?: string }>, revert: () => void, restore: () => void) {
    return new Promise<void>((resolve) => {
      this.save(null, label, run, revert, (ok) => { if (!ok) restore(); resolve(); });
    });
  }
}
