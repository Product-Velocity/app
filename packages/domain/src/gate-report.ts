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
};

export type ReadyWait = {
  /** Initiatives with a Go (or Go with conditions) at Gate B. */
  passed: number;
  /** Of those, how many have a Start Building date. */
  started: number;
  /** Days from the Gate B decision to Start Building (only when the start is on or after the decision). */
  medianDays: number | null;
  averageDays: number | null;
  /** Passed Gate B and not started: still waiting. */
  waiting: { id: string; days: number }[];
};

export type GateReport = { gates: GateStats[]; ready: ReadyWait; total: number };

/** `items` lets the report follow the filters of the Reports tab: only requests of those initiatives count. `startBuilding` is the item's Start Building date (YYYY-MM-DD) or null. */
export function gateReport(requests: readonly GateRequest[], items: ReadonlyMap<string, { startBuilding: string | null }>, now: Date): GateReport {
  const mine = requests.filter((r) => r.kind === "decision" && items.has(r.item_id));
  const nowIso = now.toISOString();
  const gates = GATE_IDS.map<GateStats>((gate) => {
    const rows = mine.filter((r) => r.gate === gate);
    const withdrawn = rows.filter((r) => r.withdrawn_at && !r.decided_at);
    const open = rows.filter((r) => !r.decided_at && !r.withdrawn_at);
    const decided = rows.filter((r) => r.decided_at);
    const took = decided.map((r) => days(r.requested_at, r.decided_at!));
    const outcomes: Record<GateOutcome, number> = { go: 0, go_with_conditions: 0, hold: 0, stop: 0 };
    for (const r of decided) if (r.outcome) outcomes[r.outcome] += 1;
    const waits = open.map((r) => days(r.requested_at, nowIso));
    return {
      gate, requested: rows.length, open: open.length, withdrawn: withdrawn.length, decided: decided.length, outcomes,
      fastLane: decided.filter((r) => r.fast_lane).length,
      medianDaysToDecide: median(took), averageDaysToDecide: average(took),
      longestOpenDays: waits.length ? Math.max(...waits) : null,
    };
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
  const waiting: ReadyWait["waiting"] = [];
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
  return { gates, total: mine.length, ready: { passed: passedB.length, started, medianDays: median(waited), averageDays: average(waited), waiting } };
}
