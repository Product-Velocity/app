import { canBeEmpty, readOnlyReason } from "./fields";
import { FIELDS, FIELD_BY_KEY, isShipped } from "./registry";

/**
 * Card view logic: which fields can be the columns and the swimlanes, the board, and what moving a card changes.
 * Pure, so the page and the tests agree. Any single-select field works; GitHub-driven ones are shown but cannot be dragged.
 */
export type AxisKind = "select" | "group" | "project" | "team";
export type AxisOption = {
  key: string; label: string; kind: AxisKind;
  /** A card can be moved across this axis (it changes the field). */
  editable: boolean;
  /** Why not, in words. */
  reason?: string;
  /** False for a field of a later phase that is listed so people know it is coming. */
  available: boolean;
};

const TEAM_REASON = "An initiative can have several teams, so its cards cannot be moved between team lanes. Change the teams in the item panel.";

/** Planning Status is the issue's default column field but arrives in phase 5; the board offers it, disabled, until then. */
const COMING = ["planning_status"];

export function axisOptions(): AxisOption[] {
  const out: AxisOption[] = [];
  for (const f of FIELDS) {
    if (f.type !== "Select" || f.key === "theme") continue;
    if (f.mode === "system" || f.mode === "computed") continue;
    if (!isShipped(f) && f.mode !== "locked") {
      if (COMING.includes(f.key)) out.push({ key: f.key, label: `${f.name} (arrives in phase ${f.phase})`, kind: "select", editable: false, available: false });
      continue;
    }
    const reason = readOnlyReason(f.key) ?? undefined;
    out.push({ key: f.key, label: f.name, kind: "select", editable: !reason, ...(reason ? { reason } : {}), available: true });
  }
  out.push({ key: "theme", label: "Initiative Group", kind: "group", editable: true, available: true });
  out.push({ key: "home_project", label: "Project", kind: "project", editable: true, available: true });
  out.push({ key: "team", label: "Team", kind: "team", editable: false, reason: TEAM_REASON, available: true });
  // Initiative Group first among the choices people make most
  const order = ["theme", "home_project", "team"];
  return [...out.filter((o) => order.includes(o.key)).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)), ...out.filter((o) => !order.includes(o.key))];
}
const OPTION_BY_KEY = new Map(axisOptions().map((o) => [o.key, o]));
export const axisLabel = (key: string) => OPTION_BY_KEY.get(key)?.label ?? FIELD_BY_KEY[key]?.name ?? key;

/** The column field of a new board: Planning Status once it ships, Initiative Phase until then. */
export function defaultColumnField(): string {
  const p = FIELD_BY_KEY.planning_status;
  return p && isShipped(p) ? "planning_status" : "initiative_phase";
}

export type AxisCtx = {
  groups: readonly string[];
  projects: readonly { id: string; name: string }[];
  teams: readonly string[];
  /** Names of the teams of one initiative. */
  teamsOf: (row: Record<string, unknown>) => string[];
};
export type AxisValue = { value: string; label: string };
const az = (a: string, b: string) => a.localeCompare(b, "en");

/** The columns or lanes of a field in display order (without "No value"). */
export function axisValues(key: string, ctx: AxisCtx): AxisValue[] {
  if (key === "theme") return [...ctx.groups].sort(az).map((g) => ({ value: g, label: g }));
  if (key === "home_project") return [...ctx.projects].sort((a, b) => az(a.name, b.name)).map((p) => ({ value: p.id, label: p.name }));
  if (key === "team") return [...ctx.teams].sort(az).map((t) => ({ value: t, label: t }));
  return (FIELD_BY_KEY[key]?.allowed ?? []).map((v) => ({ value: v, label: v }));
}

const NONE = "";
/** The values of a card on an axis: one value, or the teams, or none. */
function cellValues(row: Record<string, unknown>, key: string, ctx: AxisCtx): string[] {
  if (key === "team") return ctx.teamsOf(row);
  const v = row[key];
  return v === null || v === undefined || v === "" ? [] : [String(v)];
}
/** The value of a card on an axis as a cell key ('' = no value; for a team axis, its first team). */
export const cardValue = (row: Record<string, unknown>, key: string, ctx: AxisCtx): string => cellValues(row, key, ctx)[0] ?? NONE;
const nameOf = (key: string, value: string, ctx: AxisCtx) => (key === "home_project" ? ctx.projects.find((p) => p.id === value)?.name ?? value : value);

export type BoardRow = { id: string; stack_rank: number } & Record<string, unknown>;
export type Lane = { value: string; label: string; count: number; cells: Map<string, string[]> };
export type Board = {
  colField: string; laneField: string | null;
  columns: AxisValue[]; lanes: Lane[];
  columnCounts: Map<string, number>;
  total: number;
};

/** Columns by one field, swimlanes by another. Cards sit in their cell in global rank order; a value outside the list gets its own column. */
export function buildBoard(rows: readonly BoardRow[], colField: string, laneField: string | null, ctx: AxisCtx): Board {
  const sorted = [...rows].sort((a, b) => a.stack_rank - b.stack_rank);
  const withNone = (key: string, listed: AxisValue[], used: string[], any: boolean): AxisValue[] => {
    const extra = [...new Set(used)].filter((v) => v !== NONE && !listed.some((l) => l.value === v)).sort(az).map((v) => ({ value: v, label: nameOf(key, v, ctx) }));
    const out = [...listed, ...extra];
    if (canBeEmpty(key) || any) out.push({ value: NONE, label: "No value" });
    return out;
  };
  const colUsed = sorted.flatMap((r) => cellValues(r, colField, ctx));
  const columns = withNone(colField, axisValues(colField, ctx), colUsed, sorted.some((r) => cellValues(r, colField, ctx).length === 0));

  const laneDefs: AxisValue[] = laneField
    ? withNone(laneField, axisValues(laneField, ctx), sorted.flatMap((r) => cellValues(r, laneField, ctx)), sorted.some((r) => cellValues(r, laneField, ctx).length === 0))
    : [{ value: NONE, label: "" }];
  const lanes: Lane[] = laneDefs.map((d) => ({ value: d.value, label: d.label, count: 0, cells: new Map(columns.map((c) => [c.value, [] as string[]])) }));
  const laneOf = new Map(lanes.map((l) => [l.value, l]));
  const columnCounts = new Map<string, number>(columns.map((c) => [c.value, 0]));

  for (const r of sorted) {
    const cols = cellValues(r, colField, ctx);
    const colValue = cols[0] ?? NONE;
    columnCounts.set(colValue, (columnCounts.get(colValue) ?? 0) + 1);
    const laneValues = laneField ? cellValues(r, laneField, ctx) : [NONE];
    for (const lv of laneValues.length ? laneValues : [NONE]) {
      const lane = laneOf.get(lv);
      if (!lane) continue;
      lane.cells.get(colValue)!.push(r.id);
      lane.count++;
    }
  }
  return { colField, laneField, columns, lanes, columnCounts, total: sorted.length };
}

export type MovePlan = { ok: true; changes: Record<string, string | null> } | { ok: false; error: string };

/** What dropping a card on a cell changes: the column field when the column differs, the lane field when the lane differs. */
export function planMove(row: Record<string, unknown>, o: { colField: string; laneField: string | null; toCol: string; toLane: string }, ctx?: AxisCtx): MovePlan {
  const changes: Record<string, string | null> = {};
  const axes: [string, string][] = [[o.colField, o.toCol]];
  if (o.laneField) axes.push([o.laneField, o.toLane]);
  for (const [field, to] of axes) {
    const opt = OPTION_BY_KEY.get(field);
    const current = field === "team" ? (ctx ? ctx.teamsOf(row) : []) : cellValues(row, field, ctx ?? emptyCtx);
    const unchanged = to === NONE ? current.length === 0 : current.includes(to) && (field === "team" || current[0] === to);
    if (unchanged) continue;
    if (!opt || !opt.editable) return { ok: false, error: opt?.reason ?? `${axisLabel(field)} cannot be changed here.` };
    if (to === NONE && !canBeEmpty(field)) return { ok: false, error: `${FIELD_BY_KEY[field]?.name === "Home Project" ? "Project" : FIELD_BY_KEY[field]?.name ?? field} cannot be empty.` };
    changes[field] = to === NONE ? null : to;
  }
  return { ok: true, changes };
}
const emptyCtx: AxisCtx = { groups: [], projects: [], teams: [], teamsOf: () => [] };

/** Shift+arrow: the cell next to this one, or null at the edge (or when the card has no place on the board). */
export function cardNeighbor(b: Board, col: string, lane: string, dir: "left" | "right" | "up" | "down"): { col: string; lane: string } | null {
  const ci = b.columns.findIndex((c) => c.value === col);
  const li = b.lanes.findIndex((l) => l.value === lane);
  if (ci < 0 || li < 0) return null;
  const nc = dir === "left" ? ci - 1 : dir === "right" ? ci + 1 : ci;
  const nl = dir === "up" ? li - 1 : dir === "down" ? li + 1 : li;
  const c = b.columns[nc], l = b.lanes[nl];
  return c && l ? { col: c.value, lane: l.value } : null;
}

/** Everything a card can be moved to, for the Move menu. */
export function boardMoves(b: Board): { columns: AxisValue[]; lanes: AxisValue[] } {
  return { columns: b.columns, lanes: b.lanes.map((l) => ({ value: l.value, label: l.label })) };
}
