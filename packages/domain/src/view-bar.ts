import { VIEW_NAMES, type ViewName } from "./registry";

/** Every built-in view the bar can show: the ten defaults and "All columns". */
export const BUILTIN_BAR_NAMES = [...VIEW_NAMES, "All columns"] as const;
export type BuiltinBarName = (typeof BUILTIN_BAR_NAMES)[number];

/** The bar holds at most this many views; the rest live in the "N more views" menu. */
export const BAR_MAX = 6;
/** The workspace default bar when an admin has not changed it: the first six built-ins. */
export const DEFAULT_BAR: readonly BuiltinBarName[] = VIEW_NAMES.slice(0, BAR_MAX);
export const BAR_FULL_MESSAGE = `Your bar is full (${BAR_MAX}). Remove one first.`;
/** Caps (enforced by the database too): private views per person; workspace views including the 11 built-ins. */
export const PRIVATE_VIEW_CAP = 25;
export const WORKSPACE_VIEW_CAP = 25;

/** A view as the bar sees it: a built-in by name or a saved view by id. */
export type ViewRef = { kind: "builtin"; name: BuiltinBarName } | { kind: "saved"; id: string };
export const refKey = (r: ViewRef) => (r.kind === "builtin" ? `b:${r.name}` : `s:${r.id}`);
export const sameRef = (a: ViewRef, b: ViewRef) => refKey(a) === refKey(b);

/** One stored layout row (the person's own, or the workspace default). */
export type LayoutRow = { ref: ViewRef; inBar: boolean; position: number; hidden?: boolean };

/** A saved view as far as the bar needs to know it. `ownerId` null = workspace view. */
export type BarView = { id: string; name: string; ownerId?: string | null; baseView?: string | null };

export type MenuEntry = { ref: ViewRef; name: string; scope: "workspace" | "private"; inBar: boolean; isNew: boolean; builtin: boolean };
export type BarState = {
  /** The tabs, in order (at most six). */
  bar: ViewRef[];
  /** "My views": the person's private views not in the bar, then "Workspace views": built-ins and workspace views not in the bar. */
  mine: MenuEntry[];
  workspace: MenuEntry[];
  /** Built-ins an admin has hidden (only admins are shown them, to restore). */
  hidden: MenuEntry[];
  /** N in "N more views": the views not in the bar. */
  moreCount: number;
  /** True when the person follows the workspace default (they have no layout rows of their own). */
  followsWorkspace: boolean;
};

const byPosition = (a: LayoutRow, b: LayoutRow) => a.position - b.position;

/**
 * Works out the bar and the menu. A person's own layout overrides the workspace default; without one they follow it, and without
 * either the bar is the first six built-ins. Hidden built-ins are in neither the bar nor the menu. A workspace view with no row in a
 * customised layout is marked New.
 */
export function computeBar(input: { views: readonly BarView[]; workspaceLayout: readonly LayoutRow[]; myLayout: readonly LayoutRow[]; me: string | null }): BarState {
  const { views, workspaceLayout, myLayout, me } = input;
  const hiddenKeys = new Set(workspaceLayout.filter((r) => r.hidden).map((r) => refKey(r.ref)));
  const known = new Map<string, MenuEntry>();
  for (const n of BUILTIN_BAR_NAMES) {
    const ref: ViewRef = { kind: "builtin", name: n };
    known.set(refKey(ref), { ref, name: n, scope: "workspace", inBar: false, isNew: false, builtin: true });
  }
  for (const v of views) {
    if (v.baseView) continue; // a customised built-in is the built-in itself
    const ref: ViewRef = { kind: "saved", id: v.id };
    const owner = v.ownerId ?? null;
    if (owner !== null && owner !== me) continue; // never someone else's private view
    known.set(refKey(ref), { ref, name: v.name, scope: owner === null ? "workspace" : "private", inBar: false, isNew: false, builtin: false });
  }
  const visible = (r: LayoutRow) => known.has(refKey(r.ref)) && !hiddenKeys.has(refKey(r.ref));
  const mineRows = myLayout.filter((r) => known.has(refKey(r.ref)));
  const followsWorkspace = mineRows.length === 0;
  let barRefs: ViewRef[];
  if (!followsWorkspace) barRefs = mineRows.filter((r) => r.inBar && visible(r)).sort(byPosition).map((r) => r.ref);
  else if (workspaceLayout.some((r) => r.inBar && !r.hidden)) barRefs = workspaceLayout.filter((r) => r.inBar && visible(r)).sort(byPosition).map((r) => r.ref);
  else barRefs = DEFAULT_BAR.map((name) => ({ kind: "builtin", name }) as ViewRef).filter((r) => !hiddenKeys.has(refKey(r)));
  barRefs = barRefs.slice(0, BAR_MAX);
  const inBar = new Set(barRefs.map(refKey));
  const mentioned = new Set(mineRows.map((r) => refKey(r.ref)));
  const entries = [...known.values()].map((e) => ({
    ...e,
    inBar: inBar.has(refKey(e.ref)),
    isNew: !followsWorkspace && !e.builtin && e.scope === "workspace" && !mentioned.has(refKey(e.ref)),
  }));
  const menu = entries.filter((e) => !hiddenKeys.has(refKey(e.ref)));
  const notInBar = menu.filter((e) => !e.inBar);
  return {
    bar: barRefs,
    // the menu lists every view (so "In bar" can be toggled off); the count is the ones not in the bar
    mine: menu.filter((e) => e.scope === "private").sort((a, b) => a.name.localeCompare(b.name)),
    workspace: menu.filter((e) => e.scope === "workspace"),
    hidden: entries.filter((e) => hiddenKeys.has(refKey(e.ref))),
    moreCount: notInBar.length,
    followsWorkspace,
  };
}

/** The rows to store for a bar: the bar views in order, then every other known view as "not in bar" so later arrivals show as New. */
export function layoutRowsFor(bar: readonly ViewRef[], allKnown: readonly ViewRef[], hidden: readonly ViewRef[] = []): LayoutRow[] {
  const rows: LayoutRow[] = bar.map((ref, position) => ({ ref, inBar: true, position }));
  const inBar = new Set(bar.map(refKey));
  const hide = new Set(hidden.map(refKey));
  allKnown.filter((r) => !inBar.has(refKey(r)) && !hide.has(refKey(r))).forEach((ref, i) => rows.push({ ref, inBar: false, position: bar.length + i }));
  hidden.forEach((ref, i) => rows.push({ ref, inBar: false, position: bar.length + rows.length + i, hidden: true }));
  return rows;
}

/** Adds a view to the end of the bar. Refuses a seventh with the message the person sees. */
export function addToBar(bar: readonly ViewRef[], ref: ViewRef): { ok: true; bar: ViewRef[] } | { ok: false; error: string } {
  if (bar.some((b) => sameRef(b, ref))) return { ok: true, bar: [...bar] };
  if (bar.length >= BAR_MAX) return { ok: false, error: BAR_FULL_MESSAGE };
  return { ok: true, bar: [...bar, ref] };
}
export const removeFromBar = (bar: readonly ViewRef[], ref: ViewRef): ViewRef[] => bar.filter((b) => !sameRef(b, ref));
/** Moves the view one place (-1 earlier, +1 later); the first and last stay put. */
export function moveInBar(bar: readonly ViewRef[], ref: ViewRef, by: -1 | 1): ViewRef[] {
  const i = bar.findIndex((b) => sameRef(b, ref));
  const j = i + by;
  if (i < 0 || j < 0 || j >= bar.length) return [...bar];
  const out = [...bar];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}
/** Moves the view to a place (drag and drop). */
export function moveToIndex(bar: readonly ViewRef[], ref: ViewRef, to: number): ViewRef[] {
  const i = bar.findIndex((b) => sameRef(b, ref));
  if (i < 0) return [...bar];
  const out = bar.filter((b) => !sameRef(b, ref));
  out.splice(Math.max(0, Math.min(to, out.length)), 0, ref);
  return out;
}

/**
 * The tabs actually shown: the bar, plus the open view as a temporary extra tab at the end when it is not in the bar,
 * and fewer of them on a narrow window (the rest count toward the menu).
 */
export function visibleTabs(bar: readonly ViewRef[], open: ViewRef | null, fits: number): { tabs: ViewRef[]; extra: ViewRef | null; overflow: number } {
  const shown = bar.slice(0, Math.max(1, fits));
  const extra = open && !bar.some((b) => sameRef(b, open)) ? open : null;
  return { tabs: shown, extra, overflow: bar.length - shown.length };
}

/** A view name that is valid and free for this owner (case and spacing ignored); null when fine, else the message. */
export function nameProblem(name: string, taken: readonly string[]): string | null {
  const n = name.trim();
  if (n.length === 0) return "Give the view a name.";
  if (n.length > 80) return "Use up to 80 characters.";
  if (taken.some((t) => t.trim().toLowerCase() === n.toLowerCase())) return `You already have a view called “${n}”.`;
  return null;
}

/** "1 filter, 2 columns, sorted" for the unsaved-changes bar. */
export function changeSummary(parts: { filters: number; columns: number; grouping: boolean; sorted: boolean; pinned: boolean }): string {
  const out: string[] = [];
  if (parts.filters > 0) out.push(`${parts.filters} ${parts.filters === 1 ? "filter" : "filters"}`);
  if (parts.columns > 0) out.push(`${parts.columns} ${parts.columns === 1 ? "column" : "columns"}`);
  if (parts.pinned) out.push("pinned columns");
  if (parts.grouping) out.push("grouping");
  if (parts.sorted) out.push("sorted");
  return out.join(", ");
}

/** What differs between the saved view and what the grid shows now, for the unsaved-changes bar. */
export function diffViews(saved: ViewShape, now: ViewShape): { filters: number; columns: number; grouping: boolean; sorted: boolean; pinned: boolean } {
  const key = (f: unknown) => JSON.stringify(f);
  const a = new Set(saved.filters.map(key)), b = new Set(now.filters.map(key));
  const filters = [...a].filter((x) => !b.has(x)).length + [...b].filter((x) => !a.has(x)).length;
  const ca = new Set(saved.columns), cb = new Set(now.columns);
  let columns = [...ca].filter((x) => !cb.has(x)).length + [...cb].filter((x) => !ca.has(x)).length;
  if (columns === 0 && saved.columns.join() !== now.columns.join()) columns = 1; // same columns, new order
  return {
    filters, columns,
    grouping: (saved.groupBy ?? null) !== (now.groupBy ?? null),
    sorted: key(saved.sort ?? null) !== key(now.sort ?? null),
    pinned: (saved.pinned ?? []).join() !== (now.pinned ?? []).join(),
  };
}
type ViewShape = { columns: readonly string[]; filters: readonly unknown[]; groupBy?: string | null; sort?: unknown; pinned?: readonly string[] };
