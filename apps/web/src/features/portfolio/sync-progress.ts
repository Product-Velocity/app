import type { PlanItem, PushItemResult, ReceiveItem, ReceivedLine, SyncPreview, TakenOver } from "@/lib/github/push-types";

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

/** The counter shown while the confirmed changes are written, one initiative at a time. */
export const writingLabel = (done: number, total: number) => `Writing ${Math.min(done, total)}/${total}`;

/** Puts the results of one initiative in the list: they replace its earlier ones (a retry) and keep their place, or are added at the end. */
export function replaceResults(results: readonly PushItemResult[], id: string, fresh: readonly PushItemResult[]): PushItemResult[] {
  const at = results.findIndex((x) => x.id === id);
  if (at === -1) return [...results, ...fresh];
  const rest = results.filter((x) => x.id !== id);
  return [...rest.slice(0, at), ...fresh, ...rest.slice(at)];
}

/** An initiative the writing never reached (the connection was lost): reported as not sent, never as done. */
export const unsentResult = (id: string, code: string, message: string): PushItemResult => ({ id, code, outcome: "blocked", message });

/** Leaves out the initiatives that were already written, so a preview shown again after a stop lists only what is still open. */
export function dropWritten(state: { received: ReceiveItem[]; send: PlanItem[] }, written: ReadonlySet<string>): { received: ReceiveItem[]; send: PlanItem[] } {
  return { received: state.received.filter((r) => !written.has(r.id)), send: state.send.filter((p) => !written.has(p.id)) };
}

/** What writing one initiative came back with: its results, GitHub having changed since the preview (nothing written for it), or the connection lost. */
export type WrittenOne =
  | { kind: "result"; results: PushItemResult[]; taken: TakenOver[] }
  | { kind: "stale"; stale: SyncPreview; error: string }
  | { kind: "lost"; results: PushItemResult[] };

export type WriteRun = { results: PushItemResult[]; taken: TakenOver[]; /** Set when the run stopped at an initiative whose GitHub issue changed: it and the ones after it were not written. */ stopped?: { index: number; id: string; stale: SyncPreview; error: string } };

/**
 * Writes the initiatives one at a time, in order, reporting "done of total" and the results so far after each. One failing never stops the
 * others. It stops, writing nothing more, when GitHub changed for one (so the person sees the new difference), and when the connection is
 * lost (the ones not reached are reported as not sent).
 */
export async function writeAll(o: { todo: readonly string[]; codeOf: (id: string) => string; writeOne: (id: string) => Promise<WrittenOne>; start?: readonly PushItemResult[]; onProgress: (done: number, total: number, results: PushItemResult[]) => void }): Promise<WriteRun> {
  let results: PushItemResult[] = [...(o.start ?? [])];
  const taken: TakenOver[] = [];
  o.onProgress(0, o.todo.length, results);
  for (let n = 0; n < o.todo.length; n++) {
    const id = o.todo[n]!;
    const w = await o.writeOne(id);
    if (w.kind === "stale") return { results, taken, stopped: { index: n, id, stale: w.stale, error: w.error } };
    results = replaceResults(results, id, w.results);
    if (w.kind === "result") taken.push(...w.taken);
    o.onProgress(n + 1, o.todo.length, results);
    if (w.kind === "lost") {
      for (const rest of o.todo.slice(n + 1)) results = replaceResults(results, rest, [unsentResult(rest, o.codeOf(rest), "Not sent: the connection was lost. Run the sync again.")]);
      break;
    }
  }
  return { results, taken };
}
