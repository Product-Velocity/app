import { createHash } from "node:crypto";
import { compareTexts, type TextVerdict } from "./inbound";
import type { Board } from "./board";
import type { BoardItemValue } from "./source-control";

// Priority, Initiative Group, Due date and Size are written to the linked board by a send (docs/04) and can be changed there by people.
// This compares what the board shows now with what Product Velocity would write, three ways like the texts in `inbound.ts`:
// a difference is shown in the sync, and if both sides changed a person chooses which one to keep. Pure: the caller reads the item,
// the board values and the stored base.

export const BOARD_KEYS = ["priority", "group", "due", "size"] as const;
export type BoardKey = (typeof BOARD_KEYS)[number];
export const BOARD_LABEL: Record<BoardKey, string> = { priority: "Priority", group: "Initiative Group", due: "Due date", size: "Size" };
/** The item column a value taken over from the board lives in. This, with the texts of `inbound.ts`, is the allowlist of what GitHub can change. */
export const BOARD_COLUMN: Record<BoardKey, "moscow" | "theme" | "end_date" | "effort"> = { priority: "moscow", group: "theme", due: "end_date", size: "effort" };

const SIZES = ["XS", "S", "M", "L", "XL"];
const norm = (s: string) => s.trim().toLowerCase();
export const hashBoardValue = (s: string) => createHash("sha256").update(norm(s)).digest("hex");
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export type BoardPv = { moscow?: string | null; theme?: string | null; end_date?: string | null; effort?: string | null };
export type BoardFieldCompare = {
  key: BoardKey;
  label: string;
  verdict: TextVerdict;
  /** What Product Velocity would write (empty when it has no value). */
  pvText: string;
  /** What the board shows now. */
  githubText: string;
  pvHash: string;
  ghHash: string;
  /** The item column and value that Keep GitHub would store, or null when the board's value cannot be taken over (see `pullNote`). */
  pull: { column: (typeof BOARD_COLUMN)[BoardKey]; value: string } | null;
  pullNote?: string;
};

/** A difference a person has to look at: only the board changed, or both sides did. (`none` and `send` need no choice.) */
export const isBoardConflict = (c: Pick<BoardFieldCompare, "verdict">) => c.verdict === "github" || c.verdict === "both";

/**
 * Compares the four board values of one initiative that is on the board and returns every value that was compared, with its verdict
 * (use `isBoardConflict` to pick the ones a person must settle). `pvUnchanged`: Product Velocity has not changed since the last send,
 * so, without a stored base, its value is taken as the one both sides agreed on. Not compared at all:
 *  - a field the board does not have, or that GitHub treats as an issue field (it cannot be written through the board);
 *  - a field the board has empty: nothing on a board is ever cleared, so there is nothing to keep or take over;
 *  - an initiative whose MoSCoW is not on the board (Won't): it stays out of the board altogether.
 * Product Velocity empty and the board filled is a one-sided difference whose natural choice is to take the board's value.
 */
export function compareBoardValues(i: { board: Board; pv: BoardPv; values: Record<string, BoardItemValue>; base?: Partial<Record<BoardKey, string>>; pvUnchanged?: boolean; groups: readonly string[] }): BoardFieldCompare[] {
  const m = i.board.mapping;
  const moscow = typeof i.pv.moscow === "string" ? i.pv.moscow : "";
  if (moscow && !(moscow in m.priorityMap)) return [];
  const refs: Record<BoardKey, { id: string; name: string } | null> = { priority: m.priority, group: m.group, due: m.dueDate, size: m.size };
  const out: BoardFieldCompare[] = [];
  for (const key of BOARD_KEYS) {
    const ref = refs[key];
    if (!ref || m.unwritable?.includes(ref.id)) continue;
    const v = i.values[ref.id];
    const gh = (v?.option ?? v?.date ?? v?.text ?? "").trim();
    if (!gh) continue;
    const pv = key === "priority" ? (moscow ? m.priorityMap[moscow]! : "") : key === "group" ? (i.pv.theme ?? "").trim() : key === "due" ? (validDate(i.pv.end_date ?? "") ? i.pv.end_date! : "") : SIZES.includes(i.pv.effort ?? "") ? i.pv.effort! : "";
    const pvHash = hashBoardValue(pv);
    const ghHash = hashBoardValue(gh);
    // an empty Product Velocity value is not a change it made: only the board has a value
    const base = i.base?.[key] ?? (i.pvUnchanged ? pvHash : undefined);
    const verdict: TextVerdict = pv === "" && pvHash !== ghHash ? "github" : compareTexts(base, pvHash, ghHash);
    out.push({ key, label: BOARD_LABEL[key], verdict, pvText: pv, githubText: gh, pvHash, ghHash, ...pullOf(key, gh, m.priorityMap, i.groups) });
  }
  return out;
}

function pullOf(key: BoardKey, gh: string, priorityMap: Record<string, string>, groups: readonly string[]): { pull: BoardFieldCompare["pull"]; pullNote?: string } {
  if (key === "priority") {
    const moscow = Object.keys(priorityMap).find((k) => norm(priorityMap[k]!) === norm(gh));
    return moscow ? { pull: { column: "moscow", value: moscow } } : { pull: null, pullNote: `"${gh}" is not a priority Product Velocity knows (${Object.entries(priorityMap).map(([k, p]) => `${p} is ${k}`).join(", ")}).` };
  }
  if (key === "group") {
    const group = groups.find((g) => norm(g) === norm(gh));
    return group ? { pull: { column: "theme", value: group } } : { pull: null, pullNote: `"${gh}" is not an Initiative Group in this workspace. An admin adds it first; nothing is created from GitHub.` };
  }
  if (key === "due") return validDate(gh) ? { pull: { column: "end_date", value: gh } } : { pull: null, pullNote: `"${gh}" is not a date Product Velocity can read.` };
  const size = SIZES.find((s) => s === gh.trim().toUpperCase());
  return size ? { pull: { column: "effort", value: size } } : { pull: null, pullNote: `"${gh}" is not a size Product Velocity knows (XS, S, M, L, XL).` };
}
