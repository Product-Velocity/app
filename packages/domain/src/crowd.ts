/**
 * What the crowd said about an initiative (issue #393). Pure functions over the rows of `item_alignment_results()`, which reads the stored
 * snapshot of closed sessions (aggregates only, docs/19). Nothing here knows a name, an address or a group of fewer than 5 voters.
 * - the current result of an initiative is the one from its most recently closed session; earlier sessions are its history
 * - Crowd Rank = place in that vote (ties share a place), Crowd Score = score (top = 100), Votes = people who voted in the session (a total),
 *   Consensus = 100 minus the gap between the group rating it highest and the one rating it lowest (empty when no group is shown)
 */
export type CrowdRow = {
  itemId: string;
  sessionId: string;
  sessionName: string;
  method: "top5_duels" | "coins" | "ice";
  closedAt: string;
  place: number;
  tied: boolean;
  score: number;
  /** How many initiatives were in the vote. */
  ofItems: number;
  voters: number;
  contested: boolean;
  highGroup: string | null;
  lowGroup: string | null;
  spread: number | null;
  consensus: number | null;
};

export type CrowdFields = { crowd_rank: number | null; crowd_score: number | null; crowd_consensus: number | null; crowd_votes: number | null };

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** A row as the database function returns it (numbers can arrive as strings). */
export function toCrowdRow(r: Record<string, unknown>): CrowdRow {
  return {
    itemId: String(r.item_id), sessionId: String(r.session_id), sessionName: String(r.session_name ?? ""), method: r.method as CrowdRow["method"],
    closedAt: String(r.closed_at), place: num(r.place) ?? 0, tied: r.tied === true, score: num(r.score) ?? 0, ofItems: num(r.of_items) ?? 0, voters: num(r.voters) ?? 0,
    contested: r.contested === true, highGroup: (r.high_group as string | null) ?? null, lowGroup: (r.low_group as string | null) ?? null,
    spread: num(r.spread), consensus: num(r.consensus),
  };
}

/** One initiative's sessions, newest closed first. The first is the current result. */
export function crowdHistory(rows: CrowdRow[], itemId: string): CrowdRow[] {
  return rows.filter((r) => r.itemId === itemId).sort((a, b) => Date.parse(b.closedAt) - Date.parse(a.closedAt) || a.sessionId.localeCompare(b.sessionId));
}

/** The current result of every initiative that has one. */
export function latestCrowd(rows: CrowdRow[]): Map<string, CrowdRow> {
  const out = new Map<string, CrowdRow>();
  for (const id of new Set(rows.map((r) => r.itemId))) out.set(id, crowdHistory(rows, id)[0]!);
  return out;
}

/** The four grid fields of an initiative; all empty when it has no result. */
export function crowdFields(r: CrowdRow | undefined): CrowdFields {
  return r
    ? { crowd_rank: r.place, crowd_score: r.score, crowd_consensus: r.consensus, crowd_votes: r.voters }
    : { crowd_rank: null, crowd_score: null, crowd_consensus: null, crowd_votes: null };
}

/** "2" or "=2" for a tie: written, so a tie is never shown by colour or position alone. */
export const placeLabel = (r: Pick<CrowdRow, "place" | "tied">) => `${r.tied ? "=" : ""}${r.place}`;

/** One sentence on whether the groups agreed. Written so that it never reveals a group that is not shown. */
export function agreementText(r: Pick<CrowdRow, "contested" | "highGroup" | "lowGroup" | "spread" | "consensus">): string {
  if (r.contested) return `Contested: ${r.highGroup} rate it high, ${r.lowGroup} low${r.spread !== null ? ` (gap ${Math.round(r.spread)} of 100)` : ""}.`;
  if (r.consensus === null) return "No group view: groups with fewer than 5 voters are never shown on their own.";
  return `The groups broadly agree (consensus ${Math.round(r.consensus)} of 100).`;
}
