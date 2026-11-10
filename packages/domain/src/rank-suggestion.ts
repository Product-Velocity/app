/**
 * The order a vote suggests for the Stack Rank (issue #394). Pure functions, no I/O. A person applies it; nothing here changes a rank by itself.
 * - only the voted initiatives move, and they swap among the Stack Rank positions they already hold: everything else keeps its place,
 *   so the order of initiatives outside the vote cannot change
 * - the better the place in the vote, the better (lower) the rank among those positions
 * - initiatives that tie in the vote keep their current order relative to each other (predictable, and stated on the page)
 */
export type VotedItem = { id: string; stackRank: number; place: number; tied: boolean };
export type RankMove = { id: string; from: number; to: number; place: number; tied: boolean };

/** Where each voted initiative goes: its current position (`from`) and the suggested one (`to`), in suggested order. */
export function suggestOrder(items: VotedItem[]): RankMove[] {
  const byVote = [...items].sort((a, b) => a.place - b.place || a.stackRank - b.stackRank || a.id.localeCompare(b.id));
  const slots = items.map((i) => i.stackRank).sort((a, b) => a - b);
  return byVote.map((i, n) => ({ id: i.id, from: i.stackRank, to: slots[n]!, place: i.place, tied: i.tied }));
}

/** Only the initiatives whose rank would change. */
export const changedMoves = (moves: RankMove[]): RankMove[] => moves.filter((m) => m.from !== m.to);

/** "up 3", "down 2" or "stays": written, so a move is never shown by an arrow or a colour alone. Up means a better (lower) rank number. */
export function describeMove(m: Pick<RankMove, "from" | "to">): string {
  if (m.to === m.from) return "stays";
  return m.to < m.from ? `up ${m.from - m.to}` : `down ${m.to - m.from}`;
}

/** What the move does to the stack rank, as the words on the confirm step: "#4 to #2". */
export const describeRanks = (m: Pick<RankMove, "from" | "to">): string => `#${m.from} to #${m.to}`;

/** True when the moves only reorder the positions they already use (what the database also checks): the same set of ranks before and after, each once. */
export function isReorder(moves: Pick<RankMove, "from" | "to">[]): boolean {
  const from = moves.map((m) => m.from).sort((a, b) => a - b);
  const to = moves.map((m) => m.to).sort((a, b) => a - b);
  return from.length === to.length && new Set(from).size === from.length && from.every((v, i) => v === to[i]);
}
