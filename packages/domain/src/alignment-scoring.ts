/**
 * Scoring of an alignment session (issue #126). Pure functions, no I/O. The rules are in docs/02 (key algorithms) and docs/19 (privacy):
 * - a person's value for an initiative: coins; top 5 with duels = points by place (best gets the most, not picked gets 0); ICE = impact x confidence x ease
 * - a group's score for an initiative is the mean of its voters' values, scaled so the group's best initiative = 100
 * - the joint score is the weighted mean of the group scores (equal by default, or by headcount), scaled so the best = 100;
 *   groups the admin left out do not count
 * - groups with fewer than 5 voters are never shown on their own: they are merged into "Other", shown only at 5 or more voters;
 *   when "Other" would stay under 5, no group is shown at all (it could be worked out by subtraction), only the joint result
 * - items with the same score share a place and are shown as tied; an initiative the groups disagree about is marked contested
 * - MoSCoW (issue #746): a person's value is Must 3, Should 2, Could 1, Won't 0, so the usual score and places work; on top of that each
 *   initiative gets a suggested MoSCoW from the share of each choice (weighted like the joint score). The most chosen bucket wins; a tie goes
 *   to the more cautious one (the lower commitment: Must/Should becomes Should, Should/Could becomes Could, Could/Won't becomes Won't) and is
 *   flagged. An initiative is also contested when someone chose Must and someone chose Won't. A person only suggests; an admin sets the field.
 */
export type ScoringMethod = "top5_duels" | "coins" | "ice" | "moscow";
export type Moscow = "must" | "should" | "could" | "wont";
export const MOSCOW_ORDER: Moscow[] = ["must", "should", "could", "wont"];
export const MOSCOW_LABEL: Record<Moscow, string> = { must: "Must", should: "Should", could: "Could", wont: "Won't" };
const MOSCOW_VALUE: Record<Moscow, number> = { must: 3, should: 2, could: 1, wont: 0 };
export type Vote = { rank?: number | null; coins?: number | null; impact?: number | null; confidence?: number | null; ease?: number | null; moscow?: Moscow | null };
export type BallotInput = { group: string; votes: Record<string, Vote | undefined> };
export type GroupDef = { id: string; name: string };

export const MIN_GROUP_VOTERS = 5;
/** Two groups whose scores for one initiative are this far apart (out of 100) disagree enough to flag it. */
export const CONTESTED_SPREAD = 40;

export type ScoringInput = {
  method: ScoringMethod;
  itemIds: string[];
  ballots: BallotInput[];
  groups: GroupDef[];
  weighting: "equal" | "headcount";
  excluded: string[];
  threshold?: number;
};
export type Placed = { itemId: string; score: number; place: number; tied: boolean };
export type GroupResult = { id: string; name: string; voters: number; scores: Placed[] };
export type Contested = { itemId: string; spread: number; highGroup: string; lowGroup: string };
/** MoSCoW outcome for one initiative. counts are people; shares are percent, weighted like the joint score and adding up to 100. */
export type MoscowResult = {
  itemId: string;
  counts: Record<Moscow, number>;
  shares: Record<Moscow, number>;
  suggested: Moscow;
  /** The top buckets were level and the more cautious one was taken, or someone chose Must and someone chose Won't. */
  contested: boolean;
  tied: boolean;
};
export type Results = {
  voters: number;
  /** Only for the MoSCoW method. */
  moscow?: MoscowResult[];
  joint: Placed[];
  /** Per-group results that are safe to show, or null with the reason in `groupsNote`. */
  groups: GroupResult[] | null;
  groupsNote: string | null;
  contested: Contested[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** What one person's answer is worth for one initiative. */
export function voteValue(method: ScoringMethod, v: Vote | undefined, picks: number): number {
  if (!v) return 0;
  if (method === "moscow") return v.moscow ? MOSCOW_VALUE[v.moscow] : 0;
  if (method === "coins") return Math.max(0, v.coins ?? 0);
  if (method === "top5_duels") return v.rank ? Math.max(0, picks - v.rank + 1) : 0;
  return (v.impact ?? 0) * (v.confidence ?? 0) * (v.ease ?? 0);
}

/** Scales so the largest value becomes 100 (all zero stays zero). */
function toHundred(values: number[]): number[] {
  const max = Math.max(0, ...values);
  return values.map((v) => (max > 0 ? (v / max) * 100 : 0));
}

/** Places with ties: equal scores (to two decimals) share the better place; the next place skips as in sport (1, 2, 2, 4). */
export function place(itemIds: string[], scores: number[]): Placed[] {
  const rows = itemIds.map((itemId, i) => ({ itemId, score: r2(scores[i]!), i }));
  rows.sort((a, b) => b.score - a.score || a.i - b.i);
  const out: Placed[] = rows.map((r, n) => ({ itemId: r.itemId, score: r.score, place: 1 + rows.findIndex((x) => x.score === r.score), tied: false }));
  for (const p of out) p.tied = out.filter((x) => x.place === p.place).length > 1;
  return out;
}

/** Normalised mean score per initiative for a set of ballots. */
function groupScores(input: Pick<ScoringInput, "method" | "itemIds">, ballots: BallotInput[], picks: number): number[] {
  if (ballots.length === 0) return input.itemIds.map(() => 0);
  const means = input.itemIds.map((id) => ballots.reduce((n, b) => n + voteValue(input.method, b.votes[id], picks), 0) / ballots.length);
  return toHundred(means);
}

/** Suggested MoSCoW per initiative. Groups the admin left out do not count; groups weigh equally or by headcount, as in the joint score. */
export function moscowResults(input: Pick<ScoringInput, "itemIds" | "ballots" | "weighting" | "excluded">): MoscowResult[] {
  const byGroup = new Map<string, BallotInput[]>();
  for (const b of input.ballots) byGroup.set(b.group, [...(byGroup.get(b.group) ?? []), b]);
  const counted = [...byGroup.entries()].filter(([g]) => !input.excluded.includes(g));
  const weightSum = counted.reduce((n, [, bs]) => n + (input.weighting === "headcount" ? bs.length : 1), 0);
  return input.itemIds.map((itemId) => {
    const counts: Record<Moscow, number> = { must: 0, should: 0, could: 0, wont: 0 };
    const raw: Record<Moscow, number> = { must: 0, should: 0, could: 0, wont: 0 };
    for (const [, bs] of counted) {
      const w = input.weighting === "headcount" ? bs.length : 1;
      let given = 0;
      for (const b of bs) { const m = b.votes[itemId]?.moscow; if (m) { counts[m]++; given++; } }
      if (given > 0) for (const m of MOSCOW_ORDER) {
        const n = bs.filter((b) => b.votes[itemId]?.moscow === m).length;
        raw[m] += (n / given) * (w / weightSum) * 100;
      }
    }
    const shares = Object.fromEntries(MOSCOW_ORDER.map((m) => [m, r2(raw[m])])) as Record<Moscow, number>;
    const top = Math.max(...MOSCOW_ORDER.map((m) => shares[m]));
    const level = MOSCOW_ORDER.filter((m) => shares[m] === top);
    // cautious: the lowest commitment among the level buckets (the last in Must, Should, Could, Won't order)
    const suggested = level[level.length - 1]!;
    const tied = top > 0 && level.length > 1;
    return { itemId, counts, shares, suggested, tied, contested: tied || (counts.must > 0 && counts.wont > 0) };
  });
}

export function scoreSession(input: ScoringInput): Results {
  const threshold = input.threshold ?? MIN_GROUP_VOTERS;
  const picks = Math.min(5, input.itemIds.length);
  const byGroup = new Map<string, BallotInput[]>();
  for (const b of input.ballots) byGroup.set(b.group, [...(byGroup.get(b.group) ?? []), b]);

  // joint: every group with voters that the admin did not leave out, however small
  const counted = [...byGroup.entries()].filter(([g]) => !input.excluded.includes(g));
  let joint: number[] = input.itemIds.map(() => 0);
  const weightSum = counted.reduce((n, [, bs]) => n + (input.weighting === "headcount" ? bs.length : 1), 0);
  if (weightSum > 0) {
    for (const [, bs] of counted) {
      const w = input.weighting === "headcount" ? bs.length : 1;
      groupScores(input, bs, picks).forEach((s, i) => { joint[i] = joint[i]! + (s * w) / weightSum; });
    }
    joint = toHundred(joint);
  }
  const placedJoint = place(input.itemIds, joint);

  // per group: small groups merge into "Other"; no group at all is shown when "Other" would stay under the threshold
  const known = new Map(input.groups.map((g) => [g.id, g.name]));
  const big = [...byGroup.entries()].filter(([, bs]) => bs.length >= threshold);
  const small = [...byGroup.entries()].filter(([, bs]) => bs.length < threshold);
  const other = small.flatMap(([, bs]) => bs);
  let groups: GroupResult[] | null = null;
  let groupsNote: string | null = null;
  if (small.length > 0 && other.length < threshold) {
    groupsNote = `Groups with fewer than ${threshold} voters are not shown on their own, and together they are fewer than ${threshold}, so only the joint result is shown.`;
  } else {
    const shown: { id: string; name: string; ballots: BallotInput[] }[] = big.map(([id, bs]) => ({ id, name: known.get(id) ?? id, ballots: bs }));
    if (small.length > 0) shown.push({ id: "other", name: "Other", ballots: other });
    if (shown.length < 2) groupsNote = "There is only one group to show, which is the joint result.";
    else groups = shown.map((g) => ({ id: g.id, name: g.name, voters: g.ballots.length, scores: place(input.itemIds, groupScores(input, g.ballots, picks)) }));
  }

  const contested: Contested[] = [];
  if (groups) {
    for (const id of input.itemIds) {
      const s = groups.map((g) => ({ name: g.name, score: g.scores.find((x) => x.itemId === id)!.score }));
      const hi = s.reduce((a, b) => (b.score > a.score ? b : a));
      const lo = s.reduce((a, b) => (b.score < a.score ? b : a));
      const spread = r2(hi.score - lo.score);
      if (spread >= CONTESTED_SPREAD) contested.push({ itemId: id, spread, highGroup: hi.name, lowGroup: lo.name });
    }
    contested.sort((a, b) => b.spread - a.spread);
  }
  const moscow = input.method === "moscow" ? moscowResults(input) : undefined;
  return { voters: input.ballots.length, joint: placedJoint, groups, groupsNote, contested, ...(moscow ? { moscow } : {}) };
}
