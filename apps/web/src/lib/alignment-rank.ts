import { changedMoves, suggestOrder, type RankMove } from "@pv/domain";

/** One initiative of the suggestion: where the vote put it and where the team has it today (issue #394). */
export type SuggestionRow = { itemId: string; code: string; name: string; place: number; tied: boolean; from: number };

type Joint = { itemId: string; place: number; tied: boolean };
type Link = { id: string; item_id: string | null };
type ItemRow = { id: string; item_code: string; initiative_name: string; stack_rank: number | null; cycle_id: string | null; deleted_at: string | null };

/**
 * The initiatives of a closed session that can be reordered: still there, not in the Trash and in the default (global) Stack Rank.
 * `skipped` counts the others, so the page can say how many were left out instead of dropping them silently.
 */
export function suggestionRows(joint: Joint[], links: Link[], items: ItemRow[]): { rows: SuggestionRow[]; skipped: number } {
  const itemOf = new Map(links.map((l) => [l.id, l.item_id]));
  const byId = new Map(items.map((i) => [i.id, i]));
  const rows: SuggestionRow[] = [];
  let skipped = 0;
  for (const j of joint) {
    const id = itemOf.get(j.itemId);
    const it = id ? byId.get(id) : undefined;
    if (!id || !it || it.deleted_at || it.cycle_id !== null || it.stack_rank === null) { skipped++; continue; }
    rows.push({ itemId: id, code: it.item_code, name: it.initiative_name, place: j.place, tied: j.tied, from: it.stack_rank });
  }
  return { rows, skipped };
}

export type Plan = { ok: true; moves: RankMove[]; changed: number; scope: "all" | "selection" } | { ok: false; reason: "pick-two" | "stale" | "nothing" };

/**
 * What applying the chosen initiatives would do. `seen` is the rank the person saw for each; if any differs from today's rank the order changed
 * since the preview and the person is asked again. The moves are worked out here from the stored vote and today's ranks, never taken from the browser.
 */
export function planApply(rows: SuggestionRow[], selected: string[], seen: Record<string, number>): Plan {
  const chosen = rows.filter((r) => selected.includes(r.itemId));
  if (chosen.length < 2) return { ok: false, reason: "pick-two" };
  if (chosen.some((r) => seen[r.itemId] !== r.from)) return { ok: false, reason: "stale" };
  const moves = suggestOrder(chosen.map((r) => ({ id: r.itemId, stackRank: r.from, place: r.place, tied: r.tied })));
  const changed = changedMoves(moves).length;
  if (changed === 0) return { ok: false, reason: "nothing" };
  return { ok: true, moves, changed, scope: chosen.length === rows.length ? "all" : "selection" };
}

/** What the page says after an apply or an undo (or why it did not happen). */
export const RANK_STATUS: Record<string, string> = {
  applied: "The Stack Rank was changed. You can undo it below until someone re-ranks again.",
  undone: "The change was undone and the previous order is back.",
  "pick-two": "Choose at least two initiatives to reorder.",
  stale: "The Stack Rank changed since you looked at it, so nothing was changed. Review the suggestion again.",
  nothing: "The team already ranks these initiatives the way the vote does, so there is nothing to change.",
  "cannot-undo": "The order changed after this was applied, so it cannot be undone without overwriting that change. Nothing was changed.",
  "not-allowed": "Only an admin who is a person can apply a vote to the Stack Rank.",
  failed: "We could not change the Stack Rank. Nothing was changed.",
};
