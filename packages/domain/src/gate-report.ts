/**
 * Gate history report (issue #323 follow-up, docs/28-DECISION-GATES.md section 11): per gate, how many requests were made and decided,
 * the outcomes, how long a request waited for its decision, and the wait between Gate B and the start of building.
 * Team-level only (rule 8): nothing here is grouped by person, and no one's decision speed is shown.
 */
import { GATE_IDS, type GateId, type GateOutcome, type GateRequest } from "./gates";

const DAY = 86_400_000;
const days = (from: string, to: string) => Math.max(0, (Date.parse(to) - Date.parse(from)) / DAY);
const median = (v: number[]): number | null => {
  if (v.length === 0) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const average = (v: number[]): number | null => (v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length);

/** How a wait compares with what is usual for the same gate. No target is set anywhere: "usual" is what this workspace's own decided requests show. */
export type Pace = "faster" | "usual" | "longer" | "attention" | "unknown";
/** Quartiles of past waits, in days. `fence` is the high-end limit (Q3 plus 1.5 times the middle half, at least one day): beyond it a wait is an outlier. */
export type Spread = { n: number; min: number; q1: number; median: number; q3: number; max: number; fence: number };
/** Fewer finished waits than this say nothing about what is usual. */
export const MIN_HISTORY = 5;
/** "Lately" means decided in the last this-many days. */
export const RECENT_DAYS = 30;

const quantile = (sorted: number[], p: number): number => {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
};
export function spreadOf(values: readonly number[]): Spread | null {
  if (values.length < MIN_HISTORY) return null;
  const s = [...values].sort((a, b) => a - b);
  const q1 = quantile(s, 0.25);
  const q3 = quantile(s, 0.75);
  return { n: s.length, min: s[0]!, q1, median: quantile(s, 0.5), q3, max: s[s.length - 1]!, fence: q3 + Math.max(1.5 * (q3 - q1), 1) };
}
/** Faster than usual (below the first quartile), usual, longer than usual (above the third) or an outlier at the high end that needs attention. */
export function paceOf(days: number, spread: Spread | null): Pace {
  if (!spread) return "unknown";
  if (days > spread.fence) return "attention";
  if (days > spread.q3) return "longer";
  if (days < spread.q1) return "faster";
  return "usual";
}

export type GateStats = {
  gate: GateId;
  requested: number;
  open: number;
  withdrawn: number;
  decided: number;
  outcomes: Record<GateOutcome, number>;
  fastLane: number;
  /** Days from the request to the decision, for decided requests. */
  medianDaysToDecide: number | null;
  averageDaysToDecide: number | null;
  /** The longest an open request has been waiting, in days. */
  longestOpenDays: number | null;
  /** Spread of the decided requests (null with fewer than MIN_HISTORY), and the decided ones beyond its high fence. */
  spread: Spread | null;
  outliers: number[];
  /** Decisions of the last RECENT_DAYS days against the earlier ones: faster, slower or in line than usual. */
  lately: { n: number; median: number | null; earlierMedian: number | null; signal: "faster" | "slower" | "usual" | "unknown" };
};

/** A request still waiting for its decision. Names no person (rule 8). */
export type OpenRequest = { id: string; itemId: string; gate: GateId; days: number; pace: Pace };
/** Initiatives that asked at a gate, and how many of them passed it (Go or Go with conditions on their latest decision there). */
export type FunnelStep = { gate: GateId; initiatives: number; passed: number };
export type WaitBucket = { label: string; started: number; waiting: number };

export type ReadyWait = {
  /** Initiatives with a Go (or Go with conditions) at Gate B. */
  passed: number;
  /** Of those, how many have a Start Building date. */
  started: number;
  /** Days from the Gate B decision to Start Building (only when the start is on or after the decision). */
  medianDays: number | null;
  averageDays: number | null;
  /** Passed Gate B and not started: still waiting. */
  waiting: { id: string; days: number; pace: Pace }[];
  spread: Spread | null;
  /** Started and still-waiting initiatives by days since Gate B. */
  buckets: WaitBucket[];
};

export type GateReport = { gates: GateStats[]; ready: ReadyWait; open: OpenRequest[]; funnel: FunnelStep[]; /** Median days to decide over every decided request of every gate. */ medianDaysToDecide: number | null; total: number };

const BUCKETS: readonly { label: string; to: number }[] = [
  { label: "0–2 days", to: 2 }, { label: "3–7 days", to: 7 }, { label: "8–14 days", to: 14 }, { label: "15–30 days", to: 30 }, { label: "Over 30 days", to: Infinity },
];
const bucketOf = (d: number) => BUCKETS.findIndex((b) => Math.floor(d) <= b.to);

/** `items` lets the report follow the filters of the Reports tab: only requests of those initiatives count. `startBuilding` is the item's Start Building date (YYYY-MM-DD) or null. */
export function gateReport(requests: readonly GateRequest[], items: ReadonlyMap<string, { startBuilding: string | null }>, now: Date): GateReport {
  const mine = requests.filter((r) => r.kind === "decision" && items.has(r.item_id));
  const nowIso = now.toISOString();
  const allTook: number[] = [];
  const gates = GATE_IDS.map<GateStats>((gate) => {
    const rows = mine.filter((r) => r.gate === gate);
    const withdrawn = rows.filter((r) => r.withdrawn_at && !r.decided_at);
    const open = rows.filter((r) => !r.decided_at && !r.withdrawn_at);
    const decided = rows.filter((r) => r.decided_at);
    const took = decided.map((r) => days(r.requested_at, r.decided_at!));
    allTook.push(...took);
    const outcomes: Record<GateOutcome, number> = { go: 0, go_with_conditions: 0, hold: 0, stop: 0 };
    for (const r of decided) if (r.outcome) outcomes[r.outcome] += 1;
    const waits = open.map((r) => days(r.requested_at, nowIso));
    const spread = spreadOf(took);
    const cut = Date.parse(nowIso) - RECENT_DAYS * DAY;
    const recent = decided.filter((r) => Date.parse(r.decided_at!) >= cut).map((r) => days(r.requested_at, r.decided_at!));
    const earlier = decided.filter((r) => Date.parse(r.decided_at!) < cut).map((r) => days(r.requested_at, r.decided_at!));
    const rm = median(recent);
    const em = median(earlier);
    const signal = rm === null || em === null || recent.length < 3 || earlier.length < MIN_HISTORY ? "unknown" : rm <= em - Math.max(1, em * 0.2) ? "faster" : rm >= em + Math.max(1, em * 0.2) ? "slower" : "usual";
    return {
      gate, requested: rows.length, open: open.length, withdrawn: withdrawn.length, decided: decided.length, outcomes,
      fastLane: decided.filter((r) => r.fast_lane).length,
      medianDaysToDecide: median(took), averageDaysToDecide: average(took),
      longestOpenDays: waits.length ? Math.max(...waits) : null,
      spread, outliers: spread ? took.filter((d) => d > spread.fence).sort((a, b) => a - b) : [],
      lately: { n: recent.length, median: rm, earlierMedian: em, signal },
    };
  });
  const openRequests: OpenRequest[] = mine
    .filter((r) => !r.decided_at && !r.withdrawn_at)
    .map((r) => {
      const d = days(r.requested_at, nowIso);
      return { id: r.id, itemId: r.item_id, gate: r.gate, days: Math.floor(d), pace: paceOf(d, gates.find((g) => g.gate === r.gate)!.spread) };
    })
    .sort((a, b) => b.days - a.days);
  const funnel = GATE_IDS.map<FunnelStep>((gate) => {
    const latest = new Map<string, GateRequest>();
    for (const r of mine) {
      if (r.gate !== gate) continue;
      const cur = latest.get(r.item_id);
      if (!cur || (r.decided_at ?? "") > (cur.decided_at ?? "")) latest.set(r.item_id, r);
    }
    const all = [...latest.values()];
    return { gate, initiatives: all.length, passed: all.filter((r) => r.outcome === "go" || r.outcome === "go_with_conditions").length };
  });

  // The latest passing Gate B decision of each initiative (a later Hold or Stop on a new request replaces it only if it is newer).
  const latestB = new Map<string, GateRequest>();
  for (const r of mine) {
    if (r.gate !== "B" || !r.decided_at) continue;
    const cur = latestB.get(r.item_id);
    if (!cur || cur.decided_at! < r.decided_at) latestB.set(r.item_id, r);
  }
  const passedB = [...latestB.values()].filter((r) => r.outcome === "go" || r.outcome === "go_with_conditions");
  const waited: number[] = [];
  const waiting: { id: string; days: number }[] = [];
  let started = 0;
  for (const r of passedB) {
    const start = items.get(r.item_id)?.startBuilding ?? null;
    if (start) {
      started += 1;
      const d = days(r.decided_at!, `${start}T00:00:00Z`);
      if (Date.parse(`${start}T23:59:59Z`) >= Date.parse(r.decided_at!)) waited.push(d);
    } else waiting.push({ id: r.item_id, days: Math.floor(days(r.decided_at!, nowIso)) });
  }
  waiting.sort((a, b) => b.days - a.days);
  const spread = spreadOf(waited);
  const buckets = BUCKETS.map<WaitBucket>((b) => ({ label: b.label, started: 0, waiting: 0 }));
  for (const d of waited) buckets[bucketOf(d)]!.started += 1;
  for (const w of waiting) buckets[bucketOf(w.days)]!.waiting += 1;
  return {
    gates, open: openRequests, funnel, medianDaysToDecide: median(allTook), total: mine.length,
    ready: { passed: passedB.length, started, medianDays: median(waited), averageDays: average(waited), waiting: waiting.map((w) => ({ ...w, pace: paceOf(w.days, spread) })), spread, buckets },
  };
}
