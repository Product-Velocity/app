import type { PlanItem, ReceiveItem, ReceivedLine } from "@/lib/github/push-types";

/** How many initiatives one request checks. Small enough to finish quickly, so cards appear as they are ready. */
export const CHECK_CHUNK = 5;

export function chunk<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** A card for an initiative whose check request itself failed (network, timeout): it can be tried again on its own. */
export const failedCard = (id: string): ReceiveItem => ({ id, code: "", name: "This initiative", status: "error", received: [], issueNumber: null, issueUrl: null, message: "Could not check this initiative just now: try again." });

/** Replaces the cards and plan items of `fresh` in `current` (same id), keeping the order of `ids`; ids not yet present are added. */
export function mergeChecked(ids: readonly string[], current: { received: ReceiveItem[]; send: PlanItem[] }, fresh: { received: ReceiveItem[]; send: PlanItem[] }): { received: ReceiveItem[]; send: PlanItem[] } {
  const freshIds = new Set(fresh.received.map((r) => r.id));
  const received = [...current.received.filter((r) => !freshIds.has(r.id)), ...fresh.received];
  const send = [...current.send.filter((p) => !freshIds.has(p.id)), ...fresh.send];
  const rank = new Map(ids.map((id, i) => [id, i]));
  const byRank = <T extends { id: string }>(a: T, b: T) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0);
  return { received: received.sort(byRank), send: send.sort(byRank) };
}

/** The initiatives that were linked and read: only these can have a board Status. */
export const boardCandidates = (received: readonly ReceiveItem[]) => received.filter((r) => r.status !== "not_on_github" && r.status !== "error" && r.status !== "missing").map((r) => r.id);

/** Adds the Delivery Status changes found when the board was read (once, after all chunks) to the cards. */
export function applyBoardLines(received: readonly ReceiveItem[], lines: Record<string, ReceivedLine>, failed: boolean): ReceiveItem[] {
  const linked = new Set(boardCandidates(received));
  return received.map((r) => {
    const line = linked.has(r.id) ? lines[r.id] : undefined; // only a linked, read initiative can have a board Status
    const unreadable = failed && linked.has(r.id) && !r.message;
    if (!line && !unreadable) return r;
    return { ...r, received: line ? [...r.received, line] : r.received, status: line && (r.status === "in_step" || r.status === "follows") ? "received" : r.status, ...(unreadable ? { message: "The board could not be read just now, so Delivery Status was left as it is." } : {}) };
  });
}
