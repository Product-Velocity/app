import { createHash } from "node:crypto";
import { GitHubError, type BoardField, type BoardItemStatus, type BoardValue, type SourceControl } from "./source-control";

// What Product Velocity writes to a GitHub Project (a "board") for an initiative. Only four item values are ever read here:
// MoSCoW, Initiative Group (theme), the G2M date and the T-shirt effort estimate (docs/04). Value, confidence, customers,
// decisions and the rest never reach a board. Status, assignees, pull requests and progress belong to GitHub: read, never written.

export type FieldRef = { id: string; name: string };
export type BoardMapping = {
  priority: FieldRef | null;
  group: FieldRef | null;
  dueDate: FieldRef | null;
  size: FieldRef | null;
  /** Read back from the board (delivery status); never written. */
  status: FieldRef | null;
  /** MoSCoW value to the option name of the board's Priority field. A value that is not listed (Won't) stays out of the board. */
  priorityMap: Record<string, string>;
};

export const DEFAULT_PRIORITY_MAP: Record<string, string> = { Must: "P0", Should: "P1", Could: "P2" };
const SIZES = new Set(["XS", "S", "M", "L", "XL"]);

const NAMES = {
  priority: ["priority"],
  group: ["initiative", "initiative group", "group", "theme"],
  dueDate: ["due date", "target date", "due", "target"],
  size: ["size", "effort", "t-shirt size"],
  status: ["status", "delivery status"],
} as const;
const norm = (s: string) => s.trim().toLowerCase();

/** The board's own fields that match PV's, by their usual names (case ignored). A field of the wrong type is not a match. */
export function detectMapping(fields: BoardField[]): BoardMapping {
  const find = (names: readonly string[], types: BoardField["dataType"][]): FieldRef | null => {
    for (const n of names) {
      const f = fields.find((x) => norm(x.name) === n && types.includes(x.dataType));
      if (f) return { id: f.id, name: f.name };
    }
    return null;
  };
  return {
    priority: find(NAMES.priority, ["SINGLE_SELECT"]),
    group: find(NAMES.group, ["SINGLE_SELECT", "TEXT"]),
    dueDate: find(NAMES.dueDate, ["DATE"]),
    size: find(NAMES.size, ["SINGLE_SELECT"]),
    status: find(NAMES.status, ["SINGLE_SELECT"]),
    priorityMap: { ...DEFAULT_PRIORITY_MAP },
  };
}

export type ItemForBoard = { moscow?: string | null; theme?: string | null; end_date?: string | null; effort?: string | null };
export type BoardWrite = { field: FieldRef; /** What a person reads in the preview. */ label: string; value: BoardValue };
export type BoardPlan = { include: boolean; writes: BoardWrite[]; notes: string[]; signature: string };

const sign = (include: boolean, writes: BoardWrite[]) => createHash("sha256").update(JSON.stringify({ include, w: writes.map((x) => [x.field.id, x.value]) })).digest("hex");

/** What a push would put on the board for one initiative. Empty values write nothing (nothing on the board is ever cleared). */
export function planBoardItem(item: ItemForBoard, fields: BoardField[], mapping: BoardMapping): BoardPlan {
  const notes: string[] = [];
  const moscow = typeof item.moscow === "string" ? item.moscow : "";
  if (moscow && !(moscow in mapping.priorityMap)) {
    return { include: false, writes: [], notes: [`${moscow} initiatives stay in Product Velocity and are not added to the board.`], signature: sign(false, []) };
  }
  const writes: BoardWrite[] = [];
  const resolve = (ref: FieldRef | null): BoardField | null => {
    if (!ref) return null;
    const f = fields.find((x) => x.id === ref.id) ?? fields.find((x) => norm(x.name) === norm(ref.name));
    if (!f) notes.push(`The board no longer has a field "${ref.name}".`);
    return f ?? null;
  };
  const option = (f: BoardField, want: string): BoardValue | null => {
    if (f.dataType !== "SINGLE_SELECT") { notes.push(`The board's "${f.name}" is not a single-select field.`); return null; }
    const o = f.options?.find((x) => norm(x.name) === norm(want));
    if (!o) { notes.push(`The board's "${f.name}" has no option "${want}": add it in GitHub, nothing was written for it.`); return null; }
    return { optionId: o.id };
  };
  const add = (f: BoardField | null, value: BoardValue | null, label: string) => { if (f && value) writes.push({ field: { id: f.id, name: f.name }, label, value }); };

  if (moscow) { const f = resolve(mapping.priority); if (f) { const want = mapping.priorityMap[moscow]!; add(f, option(f, want), want); } }
  const group = typeof item.theme === "string" ? item.theme.trim() : "";
  if (group) { const f = resolve(mapping.group); if (f) add(f, f.dataType === "TEXT" ? { text: group } : option(f, group), group); }
  const due = typeof item.end_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.end_date) && !Number.isNaN(Date.parse(item.end_date)) ? item.end_date : "";
  if (due) { const f = resolve(mapping.dueDate); if (f) { if (f.dataType === "DATE") add(f, { date: due }, due); else notes.push(`The board's "${f.name}" is not a date field.`); } }
  const size = typeof item.effort === "string" && SIZES.has(item.effort) ? item.effort : "";
  if (size) { const f = resolve(mapping.size); if (f) add(f, option(f, size), size); }
  return { include: true, writes, notes, signature: sign(true, writes) };
}

/** Adds the issue to the board (adding it again returns the same item) and writes the planned values. Returns the board item id. */
export async function pushBoardItem(sc: SourceControl, installationId: number, boardId: string, issueNodeId: string, plan: BoardPlan): Promise<string> {
  const itemId = await atStep("adding the issue to the board", () => sc.addBoardItem(installationId, boardId, issueNodeId));
  for (const w of plan.writes) await atStep(`setting "${w.field.name}"`, () => sc.setBoardValue(installationId, boardId, itemId, w.field.id, w.value));
  return itemId;
}

/** A GitHub error that says which step it happened in; any other error is left alone. */
async function atStep<T>(step: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof GitHubError) throw new GitHubError(e.status, e.message, e.retryAfterSeconds, `${step}${e.detail ? `: ${e.detail}` : ""}`);
    throw e;
  }
}

/** A linked board as stored in `projects.github_board`. */
export type Board = { id: string; number: number; title: string; url: string; mapping: BoardMapping };

const ref = (v: unknown): FieldRef | null | undefined => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object") return undefined;
  const { id, name } = v as Record<string, unknown>;
  return typeof id === "string" && id.length > 0 && id.length <= 100 && typeof name === "string" && name.length > 0 && name.length <= 100 ? { id, name } : undefined;
};

/** Reads the stored JSON back into a Board, or null when it is not one (stored data is never trusted to have the right shape). */
export function parseBoard(v: unknown): Board | null {
  if (!v || typeof v !== "object") return null;
  const b = v as Record<string, unknown>;
  if (typeof b.id !== "string" || !b.id || b.id.length > 100 || !Number.isInteger(b.number) || typeof b.title !== "string" || b.title.length > 200 || typeof b.url !== "string" || !/^https:\/\//.test(b.url)) return null;
  const m = (b.mapping ?? {}) as Record<string, unknown>;
  const out: Record<string, FieldRef | null> = {};
  for (const k of ["priority", "group", "dueDate", "size", "status"]) {
    const r = ref(m[k]);
    if (r === undefined) return null;
    out[k] = r;
  }
  const pm = m.priorityMap;
  let priorityMap = { ...DEFAULT_PRIORITY_MAP };
  if (pm !== undefined) {
    if (!pm || typeof pm !== "object" || Object.entries(pm).some(([k, x]) => typeof x !== "string" || x.length > 50 || k.length > 50)) return null;
    priorityMap = { ...(pm as Record<string, string>) };
  }
  return { id: b.id, number: b.number as number, title: b.title, url: b.url, mapping: { priority: out.priority!, group: out.group!, dueDate: out.dueDate!, size: out.size!, status: out.status!, priorityMap } };
}

export const childKey = (repo: string, number: number) => `${repo.toLowerCase()}#${number}`;
export type ChildRef = { repo: string; number: number; nodeId: string };

/** Children (epics and tasks, all levels) that are not on the board yet, at most `limit` per call; `later` is how many wait for the next send. */
export function childrenToAdd(tree: ChildRef[], onBoard: ReadonlySet<string>, limit: number): { add: ChildRef[]; later: number } {
  const missing = tree.filter((c) => c.nodeId && !onBoard.has(childKey(c.repo, c.number)));
  return { add: missing.slice(0, limit), later: Math.max(missing.length - limit, 0) };
}

/** Adds each child to the board (adding twice returns the same item). Children are only added: PV writes no field values on them. */
export async function pushBoardChildren(sc: SourceControl, installationId: number, boardId: string, add: ChildRef[]): Promise<{ repo: string; number: number; boardItemId: string }[]> {
  const out: { repo: string; number: number; boardItemId: string }[] = [];
  for (const c of add) out.push({ repo: c.repo, number: c.number, boardItemId: await atStep(`adding child ${c.repo}#${c.number} to the board`, () => sc.addBoardItem(installationId, boardId, c.nodeId)) });
  return out;
}

export type StatusLink = { item_id: string; repo: string; number: number; projectItemId: string | null; current: string | null };
export type StatusRow = { item_id: string; status: string | null; board_item_id: string };

/** What to write for Delivery Status: only initiatives whose status or board item changed, matched by repository and issue number. */
export function planStatusApply(boardItems: BoardItemStatus[], links: StatusLink[]): StatusRow[] {
  const byIssue = new Map(boardItems.map((b) => [childKey(b.repo, b.number), b]));
  const out: StatusRow[] = [];
  for (const l of links) {
    const b = byIssue.get(childKey(l.repo, l.number));
    if (!b) continue; // not on the board: nothing is known, nothing is written
    const status = b.status === null ? null : b.status.slice(0, 100);
    if (status !== l.current || b.itemId !== l.projectItemId) out.push({ item_id: l.item_id, status, board_item_id: b.itemId });
  }
  return out;
}

/** The board's statuses, or nothing when the board cannot be read (a failed read must not fail a whole check). */
export async function readBoardStatuses(sc: SourceControl, installationId: number, boardId: string, statusField: string): Promise<BoardItemStatus[]> {
  try {
    return await sc.listBoardItems(installationId, boardId, statusField);
  } catch {
    return [];
  }
}
