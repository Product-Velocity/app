import { DEFAULT_VIEWS, FIELDS, sanitizeView, type ViewDef, type ViewName } from "@pv/domain";
import type { SavedView } from "../workspace/store";

/** Which view the grid started from: one of the dictionary's default views, all columns, or a saved view. */
export type BaseView = { kind: "builtin"; name: ViewName } | { kind: "all" } | { kind: "saved"; id: string };

export const ALL_COLUMNS_NAME = "All columns";

/** The view definition behind a base view (null while a saved view has not been loaded or no longer exists). */
export function baseDef(base: BaseView, saved: SavedView[]): ViewDef | null {
  if (base.kind === "builtin") return sanitizeView({ columns: DEFAULT_VIEWS[base.name], filters: [], groupBy: null });
  if (base.kind === "all") return sanitizeView({ columns: FIELDS.map((f) => f.key), filters: [], groupBy: null });
  const v = saved.find((s) => s.id === base.id);
  return v ? sanitizeView(v) : null;
}

export const sameView = (a: ViewDef, b: ViewDef) => JSON.stringify(sanitizeView(a)) === JSON.stringify(sanitizeView(b));

/** From an address parameter: a default view name, "all", or a saved view id. */
export function parseBase(param: string | null, fallback: BaseView): BaseView {
  if (!param) return fallback;
  if (param === "all" || param === ALL_COLUMNS_NAME) return { kind: "all" };
  const builtin = (Object.keys(DEFAULT_VIEWS) as ViewName[]).find((n) => n === param);
  return builtin ? { kind: "builtin", name: builtin } : { kind: "saved", id: param };
}
export function baseParam(base: BaseView): string | null {
  return base.kind === "builtin" ? (base.name === "Prioritisation" ? null : base.name) : base.kind === "all" ? "all" : base.id;
}
export const baseLabel = (base: BaseView, saved: SavedView[]) =>
  base.kind === "builtin" ? base.name : base.kind === "all" ? ALL_COLUMNS_NAME : saved.find((s) => s.id === base.id)?.name ?? "Saved view";
