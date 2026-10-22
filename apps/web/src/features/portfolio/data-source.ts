import type { EditableField } from "@pv/domain";
import type { LoadedItem } from "./types";

export type SaveResult = { ok: true } | { ok: false; error: string; conflict?: boolean };
/** What the database assigns to a new item. */
export type CreateResult = { ok: true; item_code: string; stack_rank: number } | { ok: false; error: string };
export type NewItem = {
  id: string;
  initiative_name: string;
  home_project: string;
  product_manager: string | null;
  effort: string | null;
  moscow: string | null;
};

/** Where the grid reads and writes. Supabase in the app, memory in tests. */
export interface PortfolioDataSource {
  /** All items of the workspace in global rank order (without project_rank). */
  loadItems(): Promise<LoadedItem[]>;
  /**
   * Save one field. When `expected` is given (undo and redo) the save only
   * happens if the stored value still equals it, so nobody else's change is overwritten.
   */
  updateField(itemId: string, field: EditableField, value: unknown, opts?: { expected?: unknown }): Promise<SaveResult>;
  /** Add an item at the end of the list; the id is chosen by the browser so undo and redo can refer to it. */
  createItem(item: NewItem): Promise<CreateResult>;
  /** Remove an item (undo of an add). */
  deleteItem(itemId: string): Promise<SaveResult>;
  /** Re-rank through move_item. */
  moveItem(itemId: string, toRank: number): Promise<SaveResult>;
}
