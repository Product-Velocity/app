import type { EditableField } from "@pv/domain";
import type { NewItemValues } from "@pv/domain";
import type { LoadedItem } from "./types";

export type SaveResult = { ok: true } | { ok: false; error: string; conflict?: boolean };
/** What the database assigns to new items. */
export type CreateManyResult = { ok: true; items: { id: string; item_code: string; stack_rank: number }[] } | { ok: false; error: string };
/** A new item: its id (chosen by the browser) and its field values by dictionary key. */
export type NewItem = NewItemValues & { id: string };

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
  /** Remove items in one request (undo of an add). */
  deleteItems(itemIds: string[]): Promise<SaveResult>;
  /** Re-rank through move_item. */
  moveItem(itemId: string, toRank: number): Promise<SaveResult>;
}
