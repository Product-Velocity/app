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

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Deciding the final order (issue #397): the vote is the starting point, a person may change it, and says why wherever it differs.

/** The longest reason a person can give for a rank that differs from the vote. */
export const REASON_MAX = 300;

/**
 * Where each initiative goes when the person puts them in this order: the i-th initiative gets the i-th best of the positions the chosen
 * initiatives already hold (the same rule as the vote's own suggestion, which is this function applied to the crowd's order).
 * `order` must list every chosen initiative once.
 */
export function assignRanks(order: string[], held: { id: string; stackRank: number }[], votes: Map<string, { place: number; tied: boolean }>): RankMove[] {
  const slots = held.map((h) => h.stackRank).sort((a, b) => a - b);
  const rank = new Map(held.map((h) => [h.id, h.stackRank]));
  return order.map((id, i) => ({ id, from: rank.get(id)!, to: slots[i]!, place: votes.get(id)?.place ?? 0, tied: votes.get(id)?.tied ?? false }));
}

/** True when `order` lists exactly the chosen initiatives, each once. */
export function isPermutationOf(order: string[], chosen: string[]): boolean {
  return order.length === chosen.length && new Set(order).size === order.length && order.every((id) => chosen.includes(id));
}

/** Moves one initiative to a place in the order (1 = first). A place outside the list is clamped; an unknown initiative changes nothing. */
export function moveInOrder(order: string[], id: string, place: number): string[] {
  const from = order.indexOf(id);
  if (from < 0) return order;
  const to = Math.max(0, Math.min(order.length - 1, Math.round(place) - 1));
  if (to === from) return order;
  const next = order.filter((x) => x !== id);
  next.splice(to, 0, id);
  return next;
}

export type OrderDifference = { id: string; from: number; crowd: number; final: number };

/**
 * The initiatives whose final rank is not the rank the vote suggested for the same chosen set. A reason is needed for exactly these;
 * one that matches the vote needs none (also when it does not move at all).
 */
export function differences(final: RankMove[], crowd: RankMove[]): OrderDifference[] {
  const crowdTo = new Map(crowd.map((m) => [m.id, m.to]));
  return final.filter((m) => crowdTo.get(m.id) !== m.to).map((m) => ({ id: m.id, from: m.from, crowd: crowdTo.get(m.id)!, final: m.to }));
}

/** A reason as it is stored: trimmed, with spaces collapsed. Empty or too long is not a reason (null). */
export function cleanReason(text: unknown): string | null {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length >= 1 && t.length <= REASON_MAX ? t : null;
}

/** What an admin decided for one initiative when applying a vote, and why. Seen by admins only (issue #397). */
export type RankDecision = { sessionId: string; sessionName: string; appliedAt: string; fromRank: number; toRank: number; crowdRank: number; reason: string };

/** A row of `item_alignment_decisions()` (numbers can arrive as strings). */
export function toRankDecision(r: Record<string, unknown>): RankDecision {
  return {
    sessionId: String(r.session_id), sessionName: String(r.session_name ?? ""), appliedAt: String(r.applied_at),
    fromRank: Number(r.from_rank), toRank: Number(r.to_rank), crowdRank: Number(r.crowd_rank), reason: String(r.reason ?? ""),
  };
}

/** "The vote suggested #2. Decided #5 (was #9)." */
export const decisionText = (d: Pick<RankDecision, "fromRank" | "toRank" | "crowdRank">): string =>
  `The vote suggested #${d.crowdRank}. Decided #${d.toRank} (was #${d.fromRank}).`;
