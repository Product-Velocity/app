import type { EditableField } from "@pv/domain";
import type { GridItem } from "./types";

export type SaveResult = { ok: true } | { ok: false; error: string; conflict?: boolean };

/** Where the grid reads and writes. Supabase in the app, memory in tests. */
export interface PortfolioDataSource {
  /** All items of the workspace in global rank order (without project_rank). */
  loadItems(): Promise<Omit<GridItem, "project_rank">[]>;
  /**
   * Save one field. When `expected` is given (undo and redo) the save only
   * happens if the stored value still equals it, so nobody else's change is overwritten.
   */
  updateField(itemId: string, field: EditableField, value: unknown, opts?: { expected?: unknown }): Promise<SaveResult>;
  /** Re-rank through move_item. */
  moveItem(itemId: string, toRank: number): Promise<SaveResult>;
}
