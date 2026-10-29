import type { ActivityRow, EditableField, RelatedField, RelatedValues } from "@pv/domain";
import type { NewItemValues } from "@pv/domain";
import type { IssueTreeRow, LoadedItem, TrashedItem } from "./types";

export type SaveResult = { ok: true } | { ok: false; error: string; conflict?: boolean };
/** What the database assigns to new items. */
export type CreateManyResult = { ok: true; items: { id: string; item_code: string; stack_rank: number }[] } | { ok: false; error: string };
/** A new item: its id (chosen by the browser) and its field values by dictionary key. */
export type NewItem = NewItemValues & { id: string };

/** Per-item outcome of a batch: a request that went through can still list items that could not be handled. */
export type BatchResult = { ok: true; failed: { id: string; reason: string }[] } | { ok: false; error: string };
export type RestoreResult = { ok: true; restored: { id: string; stack_rank: number }[]; failed: { id: string; reason: string }[] } | { ok: false; error: string };

/** Where the grid reads and writes. Supabase in the app, memory in tests. */
export interface PortfolioDataSource {
  /** All items of the workspace in global rank order (without project_rank). */
  loadItems(): Promise<LoadedItem[]>;
  /**
   * Save one field. When `expected` is given (undo and redo) the save only
   * happens if the stored value still equals it, so nobody else's change is overwritten.
   */
  updateField(itemId: string, field: EditableField, value: unknown, opts?: { expected?: unknown }): Promise<SaveResult>;
  /** Add items at the end of the list in one request (all or nothing). The ids are chosen by the browser so undo and redo can refer to them. */
  createMany(items: NewItem[], opts?: { via?: "import" }): Promise<CreateManyResult>;
  /** Move items to the Trash in one request. Items that cannot be deleted are listed with the reason; the others still go. */
  trashItems(itemIds: string[]): Promise<BatchResult>;
  /** Bring items back from the Trash at their old rank (undo of a delete, and Restore in the Trash view). */
  restoreItems(itemIds: string[]): Promise<RestoreResult>;
  /** The Trash of the workspace, newest first (creators and admins). */
  loadTrash(): Promise<TrashedItem[]>;
  /** Delete forever (admins; only what is in the Trash). */
  purgeItems(itemIds: string[]): Promise<BatchResult>;
  /** Remove items completely (undo of an add, by the person who just added them). */
  deleteItems(itemIds: string[]): Promise<SaveResult>;
  /** Re-rank through move_item. */
  moveItem(itemId: string, toRank: number): Promise<SaveResult>;
  /** The list fields of one item (tags, links, relations, teams), read when its panel opens. */
  loadRelated(itemId: string): Promise<RelatedValues>;
  /** Replace one list field of an item as a whole; the source adds and removes the rows that differ. */
  setRelated(itemId: string, field: RelatedField, value: unknown[]): Promise<SaveResult>;
  /** The audit log of one item (newest first), for the Activity tab. */
  loadActivity(itemId: string): Promise<ActivityRow[]>;
  /** Copies initiatives into another project as new initiatives (planning fields, tags and links; no tracker link, status or decision). */
  copyToProject(itemIds: string[], projectId: string): Promise<{ ok: true; copied: { id: string; code: string }[]; failed: { id: string; reason: string }[] } | { ok: false; error: string }>;
  /** The epics and tasks under the item's tracking issue (read-only cache of GitHub). */
  loadIssueTree(itemId: string): Promise<IssueTreeRow[]>;
  /** Marks the breakdown complete (freezes Planned Scope). Returns the item fields it changed. */
  completeBreakdown(itemId: string): Promise<{ ok: true; values: Record<string, unknown> } | { ok: false; error: string }>;
  /** Who owns a linked initiative: "push" = Product Velocity (sends after a preview and a confirmation), "follow" = read only. Writes nothing to the tracker. Returns the mode before. */
  setLinkMode(itemId: string, mode: "push" | "follow"): Promise<{ ok: true; before: "push" | "follow" } | { ok: false; error: string }>;
}
