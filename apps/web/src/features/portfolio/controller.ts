import {
  canPurge, canSeeTrash, cleanRelated, cleanSkills, isRelatedField, summarizeChange, toDay, type ActivityRow, type RelatedField, type RelatedValues,
  applyMove, canBeEmpty, canEditItems, describeEdit, EDITABLE_FIELDS, fieldLabel, localToday, projectRanks, readOnlyReason, UndoStack, validateEdit,
  bulkEditReason, isOpenList, openListValues, resolveGroup, canDeleteItem, placeRestored, type Edit, type EditableField, type Entry, type NewItemValues,
} from "@pv/domain";
import type { PortfolioDataSource, SaveResult } from "./data-source";
import type { GridItem, Lookups, LoadedItem, IssueTreeRow } from "./types";

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
    private readonly me: string | null = null,
  ) {
    this.rows = items.map((i) => ({ ...i, project_rank: 0 }));
    this.rows.sort((a, b) => a.stack_rank - b.stack_rank);
    for (const r of this.rows) this.byId.set(r.id, r);
    this.recomputeProjectRanks();
    for (const g of lookups.groups ?? []) this.groups.add(g);
    for (const r of this.rows) if (typeof r.theme === "string" && r.theme) this.groups.add(r.theme);
  }

  /** Initiative Groups: the workspace list plus any group typed or loaded here, A to Z. Open list: typing a new one creates it. */
  private readonly groups = new Set<string>();
  groupNames(): string[] { return [...this.groups].sort((a, b) => a.localeCompare(b, "en")); }
  /** The values in use of an open-list field (Focus Area, Audience), A to Z: what its editors suggest (issue #246). */
  openValues(key: string): string[] { return openListValues(this.rows.map((r) => r[key])); }
  /** A typed value of an open-list field in the spelling of the existing one (only the case differs). */
  private canonicalOpen(field: string, value: unknown): unknown {
    if (typeof value !== "string") return value;
    const r = resolveGroup(value, this.openValues(field));
    return r.kind === "empty" ? null : r.name;
  }
  /** The value to save: groups and open-list values keep one spelling. */
  private canonicalValue(field: string, value: unknown): unknown {
    return field === "theme" ? this.canonicalGroup(value) : isOpenList(field) ? this.canonicalOpen(field, value) : value;
  }
  /** A typed group in the spelling of the existing one (only the case differs), and remember a new one. */
  private canonicalGroup(value: unknown): unknown {
    if (typeof value !== "string") return value;
    const r = resolveGroup(value, this.groupNames());
    if (r.kind === "empty") return null;
    this.groups.add(r.name);
    return r.name;
  }

  /** "Today" as the grid sees it (a fixed day on the test page). */
  todayDate() { return this.today(); }
  get canEdit() { return canEditItems(this.role); }
  get canSeeTrash() { return canSeeTrash(this.role); }
  get canPurge() { return canPurge(this.role); }
  /** Admins delete any item, creators the ones they added; the database enforces the same. */
  canDelete(itemId: string): boolean {
    const row = this.byId.get(itemId);
    return !!row && canDeleteItem(this.role, this.me, (row as Record<string, unknown>)._created_by as string | null);
  }
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
  createItems(rawDrafts: NewItemValues[], opts: { via?: "import"; label?: string } = {}): { ok: true; created: number } | { ok: false; error: string } {
    const drafts = rawDrafts.map((d) => {
      let out = d;
      if ("theme" in d && d.theme) out = { ...out, theme: this.canonicalGroup(d.theme) };
      for (const k of ["focus_area", "audience"] as const) if (k in out && out[k]) out = { ...out, [k]: this.canonicalOpen(k, out[k]) };
      return out;
    });
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

  /** Put rows back where they were (same rank; the rows below shift down), as `restore_items` does. */
  private reinsert(snapshots: { row: Record<string, unknown>; rank: number }[]): GridItem[] {
    const order = placeRestored(this.rows.map((r) => r.id), snapshots.map((s) => ({ id: String(s.row.id), rank: s.rank })));
    const added = snapshots.map((s) => ({ ...s.row, project_rank: 0 }) as GridItem);
    for (const r of added) { this.rows.push(r); this.byId.set(r.id, r); }
    const place = new Map(order.map((id, i) => [id, i + 1]));
    const changed: GridItem[] = [];
    for (const r of this.rows) { const n = place.get(r.id)!; if (r.stack_rank !== n) { r.stack_rank = n; if (!added.includes(r)) changed.push(r); } }
    this.rows.sort((a, b) => a.stack_rank - b.stack_rank);
    for (const c of this.recomputeProjectRanks()) if (!changed.includes(c) && !added.includes(c)) changed.push(c);
    for (const l of this.structureListeners) l(added, []);
    this.emit(changed);
    return added;
  }

  /**
   * Delete: the rows leave the grid at once, go to the Trash in ONE request, and one undo step (Ctrl+Z) brings them back
   * at their old ranks. Items the person may not delete are skipped and listed; the rest still go.
   */
  deleteItems(itemIds: string[]): { ok: true; deleted: number; skipped: { id: string; name: string; reason: string }[] } | { ok: false; error: string } {
    if (!this.canEdit) { this.notify(READ_ONLY_MESSAGE); return { ok: false, error: READ_ONLY_MESSAGE }; }
    const rows = [...new Set(itemIds)].map((id) => this.byId.get(id)).filter((r): r is GridItem => !!r);
    const todo: GridItem[] = [];
    const skipped: { id: string; name: string; reason: string }[] = [];
    for (const r of rows) {
      if (this.canDelete(r.id)) todo.push(r);
      else skipped.push({ id: r.id, name: r.initiative_name, reason: "Only the person who added it or an admin can delete it." });
    }
    if (todo.length === 0) {
      if (skipped.length > 0) this.notify(`Nothing deleted: ${skipped[0]!.reason}`);
      return { ok: true, deleted: 0, skipped };
    }
    const edits = todo.map((row): Edit => ({ type: "delete", itemId: row.id, key: row.item_code, name: row.initiative_name, rank: row.stack_rank, row: { ...row } }));
    const label = todo.length === 1 ? undefined : `Deleted ${todo.length} items`;
    const entry: Entry = { id: `e${++this.entrySeq}`, edits, ...(label ? { label } : {}) };
    this.stack.push(entry);
    this.state.notice = skipped.length > 0 ? `${skipped.length} could not be deleted: ${skipped[0]!.reason}` : null;
    this.state.last = { text: label ?? describeEdit(edits[0]!, this.resolvers()), at: this.now() };
    this.removeRows(todo);
    let failed: { id: string; reason: string }[] = [];
    const what = todo.length === 1 ? todo[0]!.item_code : `${todo.length} items`;
    this.save(null, what, async () => {
      const r = await this.source.trashItems(todo.map((x) => x.id));
      if (r.ok) failed = r.failed;
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    }, () => {
      this.reinsert(edits.filter((e): e is Extract<Edit, { type: "delete" }> => e.type === "delete").map((e) => ({ row: e.row, rank: e.rank })));
      this.stack.discard(entry);
    }, (ok) => {
      if (!ok || failed.length === 0) return;
      // some could not be deleted on the server: they come back, and the undo step no longer covers them
      const bad = new Set(failed.map((f) => f.id));
      const back = edits.filter((e): e is Extract<Edit, { type: "delete" }> => e.type === "delete" && bad.has(e.itemId));
      // their place is the old rank minus the deleted items that were above them
      const gone = edits.filter((e): e is Extract<Edit, { type: "delete" }> => e.type === "delete" && !bad.has(e.itemId));
      this.reinsert(back.map((e) => ({ row: e.row, rank: e.rank - gone.filter((g) => g.rank < e.rank).length })));
      entry.edits = entry.edits.filter((e) => !back.includes(e as never));
      if (entry.edits.length === 0) this.stack.discard(entry);
      this.state.error = `${failed.length} ${failed.length === 1 ? "item" : "items"} could not be deleted: ${failed[0]!.reason}`;
    }, "Could not delete");
    return { ok: true, deleted: todo.length, skipped };
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
    const checked = validateEdit(field, raw, { today: this.today() });
    if (!checked.ok) { this.notify(`${fieldLabel(field)}: ${checked.error}`); return { ok: false, error: checked.error }; }
    const v = { ...checked, value: this.canonicalValue(field, checked.value) } as typeof checked;
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
    const checked = validateEdit(field, raw, { today: this.today() });
    if (!checked.ok) { this.notify(`${row.item_code} ${fieldLabel(field)}: ${checked.error}`); return { ok: false, error: checked.error }; }
    const v = { ...checked, value: this.canonicalValue(field, checked.value) } as typeof checked;
    return this.commitField(row, field, v.value);
  }

  /** Optimistic change of one field to an already typed value: undo step, status line, background save, revert on failure. */
  private commitField(row: GridItem, field: EditableField, value: unknown): EditOutcome {
    const itemId = row.id;
    const before = row[field];
    if (same(before, value)) return { ok: true, changed: false };
    const edit: Edit = { type: "field", itemId, key: row.item_code, field, before, after: value };
    const entry: Entry = { id: `e${++this.entrySeq}`, edits: [edit] };
    this.applyField(row, field, value);
    this.stack.push(entry);
    this.state.notice = null;
    this.state.last = { text: describeEdit(edit, this.resolvers()), at: this.now() };
    this.save(entry, `${row.item_code} ${fieldLabel(field)}`, () => this.source.updateField(itemId, field, value), () => {
      // save failed: put the old value back
      const cur = this.byId.get(itemId);
      if (cur && same(cur[field], value)) this.applyField(cur, field, before);
    });
    return { ok: true, changed: true };
  }

  /** A field the panel edits with its own editor and hands over as a typed value (effort by skill). */
  setValue(itemId: string, field: EditableField, value: unknown): EditOutcome {
    if (!this.canEdit) { this.notify(READ_ONLY_MESSAGE); return { ok: false, error: READ_ONLY_MESSAGE }; }
    const row = this.byId.get(itemId);
    if (!row) return { ok: false, error: "That item no longer exists." };
    if (field !== "effort_by_skill") return { ok: false, error: "That field cannot be edited." };
    const c = cleanSkills(value);
    if (!c.ok) { this.notify(`${row.item_code} ${fieldLabel(field)}: ${c.error}`); return { ok: false, error: c.error }; }
    return this.commitField(row, field, c.value);
  }

  /** Undo of one change from the Activity log: only while the field still holds what that change set. */
  restoreValue(itemId: string, field: EditableField, expectedNow: unknown, value: unknown): EditOutcome {
    if (!this.canEdit) { this.notify(READ_ONLY_MESSAGE); return { ok: false, error: READ_ONLY_MESSAGE }; }
    const row = this.byId.get(itemId);
    if (!row) return { ok: false, error: "That item no longer exists." };
    if (!EDITABLE_FIELDS.includes(field) && field !== "effort_by_skill") return { ok: false, error: readOnlyReason(field) ?? "That field cannot be edited." };
    if (!same(row[field], expectedNow) && JSON.stringify(row[field]) !== JSON.stringify(expectedNow)) return { ok: false, error: "The value has changed since. Undo the newer change first." };
    return this.commitField(row, field, value);
  }

  /**
   * Planned Start and G2M Date (est) together: what moving or resizing a Gantt bar changes. One undo step, one saved
   * change per date that differs (each audited by the database).
   */
  setDates(itemId: string, dates: { planned_start: string; g2m_date_est: string }): EditOutcome {
    if (!this.canEdit) { this.notify(READ_ONLY_MESSAGE); return { ok: false, error: READ_ONLY_MESSAGE }; }
    const row = this.byId.get(itemId);
    if (!row) return { ok: false, error: "That item no longer exists." };
    for (const field of ["planned_start", "g2m_date_est"] as const) {
      const reason = readOnlyReason(field);
      if (reason) { this.notify(reason); return { ok: false, error: reason }; }
      if (Number.isNaN(toDay(String(dates[field])))) { const error = `${fieldLabel(field)} is not a date.`; this.notify(error); return { ok: false, error }; }
    }
    const s = toDay(dates.planned_start), e = toDay(dates.g2m_date_est);
    if (e < s) { const error = "G2M Date (est) cannot be before Planned Start."; this.notify(error); return { ok: false, error }; }
    const edits: Edit[] = [];
    for (const field of ["planned_start", "g2m_date_est"] as const) {
      if (row[field] !== dates[field]) edits.push({ type: "field", itemId, key: row.item_code, field, before: row[field] ?? null, after: dates[field] });
    }
    if (edits.length === 0) return { ok: true, changed: false };
    const before = { startDay: toDay(String(row.planned_start)), endDay: toDay(String(row.g2m_date_est)) };
    const text = Number.isNaN(before.startDay) || Number.isNaN(before.endDay)
      ? `${row.item_code} scheduled: Planned Start ${dates.planned_start}, G2M Date (est) ${dates.g2m_date_est}`
      : `${row.item_code} ${summarizeChange(before, { startDay: s, endDay: e }, this.today())}`;
    this.commitMany(row, edits, text);
    return { ok: true, changed: true };
  }

  /**
   * Several fields of one item as one undo step: what dropping a card on another column and lane changes.
   * `null` clears a field. Everything is checked first; if one value is refused, nothing changes.
   */
  editFields(itemId: string, changes: Record<string, string | null>): EditOutcome {
    if (!this.canEdit) { this.notify(READ_ONLY_MESSAGE); return { ok: false, error: READ_ONLY_MESSAGE }; }
    const row = this.byId.get(itemId);
    if (!row) return { ok: false, error: "That item no longer exists." };
    const edits: Edit[] = [];
    for (const [field, raw] of Object.entries(changes)) {
      if (!EDITABLE_FIELDS.includes(field)) { const error = readOnlyReason(field) ?? "That field cannot be edited."; this.notify(error); return { ok: false, error }; }
      const checked = validateEdit(field, raw ?? "", { today: this.today() });
      if (!checked.ok) { this.notify(`${row.item_code} ${fieldLabel(field)}: ${checked.error}`); return { ok: false, error: checked.error }; }
      const value = this.canonicalValue(field, checked.value);
      if (!same(row[field], value)) edits.push({ type: "field", itemId, key: row.item_code, field, before: row[field] ?? null, after: value });
    }
    if (edits.length === 0) return { ok: true, changed: false };
    const first = describeEdit(edits[0]!, this.resolvers());
    const rest = edits.slice(1).map((e) => describeEdit(e, this.resolvers()).slice(row.item_code.length + 1));
    this.commitMany(row, edits, [first, ...rest].join(", "));
    return { ok: true, changed: true };
  }

  /** One undo step for several field edits of one item, each saved (and audited) on its own; a failed one is put back alone. */
  private commitMany(row: GridItem, edits: Edit[], text: string) {
    const itemId = row.id;
    const entry: Entry = { id: `e${++this.entrySeq}`, edits, label: text };
    this.stack.push(entry);
    this.state.notice = null;
    this.state.last = { text, at: this.now() };
    for (const edit of edits) {
      if (edit.type !== "field") continue;
      this.applyField(row, edit.field, edit.after);
      this.save(null, `${row.item_code} ${fieldLabel(edit.field)}`, () => this.source.updateField(itemId, edit.field, edit.after), () => {
        const cur = this.byId.get(itemId);
        if (cur && same(cur[edit.field], edit.after)) this.applyField(cur, edit.field, edit.before);
        const at = entry.edits.indexOf(edit);
        if (at >= 0) entry.edits.splice(at, 1);
        if (entry.edits.length === 0) this.stack.discard(entry);
      }, undefined, "Could not save", `${itemId}:${edit.field}`);
    }
  }

  /**
   * Texts taken over from GitHub by Sync with GitHub are already saved by the server (and audited). Show them in the grid and make
   * all of them one undo step; undoing writes the old texts back through the normal guarded edit.
   */
  recordTakenOver(changes: { itemId: string; field: EditableField; before: unknown; after: unknown }[]) {
    const edits: Edit[] = [];
    const touched: GridItem[] = [];
    for (const c of changes) {
      const row = this.byId.get(c.itemId);
      if (!row) continue;
      this.applyField(row, c.field, c.after);
      touched.push(row);
      edits.push({ type: "field", itemId: c.itemId, key: row.item_code, field: c.field, before: c.before ?? "", after: c.after ?? "" });
    }
    if (edits.length === 0) return;
    const label = `Took over ${edits.length} text${edits.length === 1 ? "" : "s"} from GitHub`;
    this.stack.push({ id: `e${++this.entrySeq}`, edits, label });
    this.state.notice = null;
    this.state.last = { text: label, at: this.now() };
    this.emit(touched);
  }

  /**
   * The grid loads once, but GitHub (webhooks, Sync with GitHub) and other people change items in the database meanwhile.
   * Fetch again and copy the values that differ into the rows we already show. Skipped while saves are pending, so a
   * stale read never overwrites an edit in flight; the next refresh catches up. Rank and added or removed items are left alone.
   */
  async refreshFromServer(): Promise<void> {
    if (this.state.pending > 0) return;
    let fresh: LoadedItem[];
    try { fresh = await this.source.loadItems(); } catch { return; } // a failed background refresh must not disturb the grid
    if (this.state.pending > 0) return;
    const changed: GridItem[] = [];
    for (const f of fresh) {
      const row = this.byId.get(f.id);
      if (!row) continue;
      const rec = row as unknown as Record<string, unknown>;
      let touched = false;
      for (const [k, v] of Object.entries(f as unknown as Record<string, unknown>)) {
        if (k === "stack_rank" || k === "project_rank" || same(rec[k], v)) continue;
        rec[k] = v;
        touched = true;
      }
      if (touched) changed.push(row);
    }
    // initiatives created or removed elsewhere (pulled in from the Sync window, removed in another tab or by an undo there). An empty answer
    // is never taken as "everything was removed".
    const freshIds = new Set(fresh.map((f) => f.id));
    const gone = fresh.length > 0 ? this.rows.filter((r) => !freshIds.has(r.id)) : [];
    const added = fresh.filter((f) => !this.byId.has(f.id)).map((f) => ({ ...f, project_rank: 0 }) as GridItem);
    if (changed.length > 0) this.emit(changed);
    if (gone.length > 0) this.removeRows(gone);
    if (added.length > 0) this.addRows(added);
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

  // ------------------------------------------------------- list fields (item panel)
  private readonly relatedCache = new Map<string, RelatedValues>();
  private readonly relatedLoading = new Map<string, Promise<RelatedValues>>();
  /** What the panel knows of an item's list fields (undefined until `loadRelated` has finished). */
  relatedOf(itemId: string): RelatedValues | undefined { return this.relatedCache.get(itemId); }
  async loadRelated(itemId: string): Promise<RelatedValues> {
    const have = this.relatedCache.get(itemId);
    if (have) return have;
    let p = this.relatedLoading.get(itemId);
    if (!p) {
      p = this.source.loadRelated(itemId).then((r) => { this.relatedCache.set(itemId, r); this.relatedLoading.delete(itemId); this.emit(); return r; }, (e) => { this.relatedLoading.delete(itemId); throw e; });
      this.relatedLoading.set(itemId, p);
    }
    return p;
  }
  teams() { return this.lookups.teams ?? []; }
  members() { return this.lookups.members ?? []; }
  activity(itemId: string): Promise<ActivityRow[]> { return this.source.loadActivity(itemId); }
  /** Copy initiatives into another project (new initiatives; the originals stay). The new rows appear when the page reloads. */
  async copyToProject(itemIds: string[], projectId: string) {
    if (!this.canEdit) { this.notify(READ_ONLY_MESSAGE); return { ok: false as const, error: READ_ONLY_MESSAGE }; }
    return this.source.copyToProject(itemIds, projectId);
  }
  issueTree(itemId: string): Promise<IssueTreeRow[]> { return this.source.loadIssueTree(itemId); }
  /** "Mark breakdown complete": the database freezes Planned Scope; the row shows the new values at once. */
  async completeBreakdown(itemId: string): Promise<SaveResult> {
    if (!this.canEdit) { this.notify(READ_ONLY_MESSAGE); return { ok: false, error: READ_ONLY_MESSAGE }; }
    const r = await this.source.completeBreakdown(itemId);
    if (!r.ok) { this.notify(r.error); return { ok: false, error: r.error }; }
    const row = this.byId.get(itemId);
    if (row) Object.assign(row, r.values);
    this.emit();
    return { ok: true };
  }

  /**
   * Takes ownership of a linked initiative ("push": Product Velocity sends what it is, after a preview and a confirmation) or makes it
   * read only again ("follow"). Writes nothing to the tracker. Returns the mode before, so the caller can offer the undo.
   */
  async setLinkMode(itemId: string, mode: "push" | "follow"): Promise<{ ok: true; before: "push" | "follow" } | { ok: false; error: string }> {
    if (!this.canEdit) { this.notify(READ_ONLY_MESSAGE); return { ok: false, error: READ_ONLY_MESSAGE }; }
    const r = await this.source.setLinkMode(itemId, mode);
    if (!r.ok) { this.notify(r.error); return r; }
    const link = this.lookups.github?.links[itemId];
    if (link) link.mode = mode;
    this.emit();
    return r;
  }

  /** The grid cell of a list field shows the list as text. */
  private listText(field: RelatedField, list: unknown[]): string | null {
    const text = list.map((x) => {
      if (field === "artifacts") { const l = x as { label: string; url: string }; return l.label ? `${l.label} (${l.url})` : l.url; }
      if (field === "depends_on" || field === "related_to") return this.byId.get(String(x))?.item_code ?? "(deleted item)";
      if (field === "contributing_teams") return this.teams().find((t) => t.id === x)?.name ?? "unknown team";
      if (field === "assignees") return this.members().find((m) => m.user_id === x)?.email ?? "unknown person";
      return String(x);
    }).join(field === "artifacts" || field === "depends_on" || field === "related_to" ? "; " : ", ");
    return text || null;
  }
  private applyRelated(itemId: string, field: RelatedField, list: unknown[]) {
    const cur = this.relatedCache.get(itemId);
    if (cur) (cur as Record<string, unknown[]>)[field] = list;
    const row = this.byId.get(itemId);
    if (row) (row as Record<string, unknown>)[field] = this.listText(field, list);
    this.emit(row ? [row] : []);
  }

  /** Replace one list field of an item (tags, links, relations, teams): optimistic, one undo step, saved in the background. */
  editRelated(itemId: string, field: string, list: unknown[]): EditOutcome {
    if (!this.canEdit) { this.notify(READ_ONLY_MESSAGE); return { ok: false, error: READ_ONLY_MESSAGE }; }
    const row = this.byId.get(itemId);
    if (!row) return { ok: false, error: "That item no longer exists." };
    if (!isRelatedField(field)) return { ok: false, error: "That field cannot be edited." };
    const cur = this.relatedCache.get(itemId);
    if (!cur) return { ok: false, error: "Wait for the list to load." };
    const c = cleanRelated(field, list, { itemId, itemIds: this.rows.map((r) => r.id), teamIds: this.teams().map((t) => t.id), memberIds: this.members().map((m) => m.user_id) });
    if (!c.ok) { this.notify(`${row.item_code} ${fieldLabel(field)}: ${c.error}`); return { ok: false, error: c.error }; }
    const before = [...(cur[field] as unknown[])];
    if (JSON.stringify(before) === JSON.stringify(c.value)) return { ok: true, changed: false };
    const edit: Edit = { type: "related", itemId, key: row.item_code, field, before, after: c.value };
    const entry: Entry = { id: `e${++this.entrySeq}`, edits: [edit] };
    this.applyRelated(itemId, field, c.value);
    this.stack.push(entry);
    this.state.notice = null;
    this.state.last = { text: describeEdit(edit, this.resolvers()), at: this.now() };
    this.save(entry, `${row.item_code} ${fieldLabel(field)}`, () => this.source.setRelated(itemId, field, c.value), () => {
      if (JSON.stringify(this.relatedCache.get(itemId)?.[field]) === JSON.stringify(c.value)) this.applyRelated(itemId, field, before);
    });
    return { ok: true, changed: true };
  }

  // ---------------------------------------------------------------- saving
  /** Saves for the same cell go one after the other, so the last edit always wins. */
  private save(entry: Entry | null, label: string, run: () => Promise<{ ok: boolean; error?: string }>, revert: () => void, onDone?: (ok: boolean) => void, failVerb = "Could not save", queueKeyOverride?: string) {
    const edit = entry?.edits[0];
    const queueKey = queueKeyOverride ?? (edit ? `${edit.itemId}:${edit.type === "field" ? edit.field : edit.type === "related" ? `rel:${edit.field}` : "rank"}` : "misc");
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
      direction === "undo" && e.type !== "create" && e.type !== "delete" ? ({ ...e, before: e.after, after: e.before } as Edit) : e;
    if (entry.edits.length > 0 && entry.edits.every((e) => e.type === "create")) {
      await this.replayCreates(entry, entry.edits as Extract<Edit, { type: "create" }>[], direction, restore);
      return;
    }
    if (entry.edits.length > 0 && entry.edits.every((e) => e.type === "delete")) {
      await this.replayDeletes(entry, entry.edits as Extract<Edit, { type: "delete" }>[], direction, restore);
      return;
    }
    // newest edit first when undoing
    const edits = direction === "undo" ? [...entry.edits].reverse() : entry.edits;
    for (const edit of edits) {
      if (edit.type === "create" || edit.type === "delete") continue; // never mixed with other edits

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
      } else if (edit.type === "related") {
        const field = edit.field as RelatedField;
        const cur = (await this.loadRelated(edit.itemId))[field] as unknown[];
        if (JSON.stringify(cur) !== JSON.stringify(expected)) {
          this.state.error = `Could not ${direction} ${edit.key} ${fieldLabel(field)}: it was changed in the meantime.`;
          this.emit(); restore(); return;
        }
        this.applyRelated(edit.itemId, field, target as unknown[]);
        this.state.last = { text: `${verb}: ${describeEdit(shown(edit), this.resolvers())}`, at: this.now() };
        this.emit();
        await this.runReplaySave(`${edit.key} ${fieldLabel(field)}`, () => this.source.setRelated(edit.itemId, field, target as unknown[]), () => {
          this.applyRelated(edit.itemId, field, expected as unknown[]);
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

  /** Undo of a delete restores the batch from the Trash at the old ranks; redo deletes it again. */
  private async replayDeletes(entry: Entry, edits: Extract<Edit, { type: "delete" }>[], direction: "undo" | "redo", restore: () => void) {
    const text = entry.label ?? describeEdit(edits[0]!, this.resolvers());
    const ids = edits.map((e) => e.itemId);
    if (direction === "undo") {
      if (ids.some((id) => this.byId.has(id))) { this.state.error = "Could not undo: an item is already back."; this.emit(); restore(); return; }
      const added = this.reinsert(edits.map((e) => ({ row: e.row, rank: e.rank })));
      this.state.last = { text: `Undid: ${text}`, at: this.now() };
      this.emit();
      await this.runReplaySave("restoring the items", async () => {
        const r = await this.source.restoreItems(ids);
        if (!r.ok) return { ok: false, error: r.error };
        if (r.failed.length > 0) return { ok: false, error: r.failed[0]!.reason };
        return { ok: true };
      }, () => this.removeRows(added.filter((x) => this.byId.has(x.id))), restore);
      return;
    }
    const rows = ids.map((id) => this.byId.get(id)).filter((r): r is GridItem => !!r);
    if (rows.length !== ids.length) { this.state.error = "Could not redo: an item no longer exists."; this.emit(); restore(); return; }
    for (const e of edits) { const r = this.byId.get(e.itemId)!; e.rank = r.stack_rank; e.row = { ...r }; }
    this.removeRows(rows);
    this.state.last = { text: `Redid: ${text}`, at: this.now() };
    this.emit();
    await this.runReplaySave("deleting the items again", async () => {
      const r = await this.source.trashItems(ids);
      if (!r.ok) return { ok: false, error: r.error };
      if (r.failed.length > 0) return { ok: false, error: r.failed[0]!.reason };
      return { ok: true };
    }, () => this.reinsert(edits.map((e) => ({ row: e.row, rank: e.rank }))), restore);
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
