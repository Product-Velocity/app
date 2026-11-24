/**
 * What a phone shows of an alignment session (issue #635, slice P3): the session, how many voted, the top initiatives and how many are contested. Pure rules over the
 * results copy stored when a session closes (aggregates only: no name, no address, no group of fewer than 5 voters, CLAUDE.md rule 7). An admin sees more on the
 * results page; the phone shows what every member may read.
 */
export type SessionDb = { id: string; name: string; method: string; status: string; closed_at: string | null; closes_at: string | null; results_snapshot: unknown };
export type Snapshot = {
  voters?: number; items?: { id: string; name: string }[];
  results?: { joint?: { itemId: string; score: number; place: number; tied: boolean }[]; contested?: unknown[] };
};
export type TopItem = { name: string; place: number; tied: boolean };
export type SessionSummary = {
  id: string; name: string; method: string; final: boolean; when: string | null;
  voters: number | null; top: TopItem[]; contested: number | null; more: number;
};

export const TOP_N = 5;
const METHOD: Record<string, string> = { top5_duels: "Top 5 and duels", coins: "100 coins", ice: "Impact, confidence, ease" };
export const methodLabel = (m: string) => METHOD[m] ?? m.replace(/_/g, " ");

/** Closed and archived sessions have their results copy; an open one has none yet (an admin opens its provisional results on the results page). */
export function summarizeSession(s: SessionDb, top = TOP_N): SessionSummary {
  const final = s.status === "closed" || s.status === "archived";
  const snap = (final && s.results_snapshot && typeof s.results_snapshot === "object" ? s.results_snapshot : null) as Snapshot | null;
  const names = new Map((snap?.items ?? []).map((i) => [i.id, i.name]));
  const joint = [...(snap?.results?.joint ?? [])].sort((a, b) => a.place - b.place);
  const shown = joint.filter((j) => names.has(j.itemId)).slice(0, top).map((j) => ({ name: names.get(j.itemId)!, place: j.place, tied: j.tied }));
  return {
    id: s.id, name: s.name, method: methodLabel(s.method), final, when: final ? s.closed_at ?? s.closes_at : s.closes_at,
    voters: typeof snap?.voters === "number" ? snap.voters : null, top: shown,
    contested: Array.isArray(snap?.results?.contested) ? snap!.results!.contested!.length : null,
    more: Math.max(0, joint.filter((j) => names.has(j.itemId)).length - shown.length),
  };
}

/** Closed and archived first (newest closing first), then the open ones that this person may read (admins only; the database returns no other row). */
export function orderSessions(rows: readonly SessionDb[]): SessionDb[] {
  const done = (s: SessionDb) => s.status === "closed" || s.status === "archived";
  return [...rows].filter((s) => s.status !== "draft").sort((a, b) => Number(done(b)) - Number(done(a)) || Date.parse(b.closed_at ?? b.closes_at ?? "") - Date.parse(a.closed_at ?? a.closes_at ?? "") || a.name.localeCompare(b.name));
}
