import { describe, expect, it } from "vitest";
import { gateReport, paceOf, spreadOf } from "./gate-report";
import type { GateRequest } from "./gates";

const req = (o: Partial<GateRequest> & Pick<GateRequest, "id" | "item_id" | "gate" | "requested_at">): GateRequest => ({
  kind: "decision", requested_by: null, preferred_approvers: [], ready: true, criteria: [], outcome: null, rationale: null, fast_lane: false,
  target_phase: null, skipped_phases: [], review_date: null, decided_by: null, decided_at: null, withdrawn_at: null, ...o,
});
const now = new Date("2026-11-20T00:00:00Z");
const items = new Map([["a", { startBuilding: "2026-11-10" }], ["b", { startBuilding: null }], ["c", { startBuilding: null }]]);

describe("gateReport", () => {
  const rows = [
    req({ id: "1", item_id: "a", gate: "B", requested_at: "2026-11-01T00:00:00Z", decided_at: "2026-11-05T00:00:00Z", outcome: "go" }),
    req({ id: "2", item_id: "b", gate: "B", requested_at: "2026-11-02T00:00:00Z", decided_at: "2026-11-04T00:00:00Z", outcome: "go_with_conditions", fast_lane: true }),
    req({ id: "3", item_id: "c", gate: "B", requested_at: "2026-11-10T00:00:00Z" }),
    req({ id: "4", item_id: "c", gate: "A", requested_at: "2026-10-01T00:00:00Z", decided_at: "2026-10-03T00:00:00Z", outcome: "stop" }),
    req({ id: "5", item_id: "x", gate: "A", requested_at: "2026-10-01T00:00:00Z" }), // not in the filtered items
    req({ id: "6", item_id: "c", gate: "C", requested_at: "2026-11-01T00:00:00Z", withdrawn_at: "2026-11-02T00:00:00Z" }),
  ];
  const r = gateReport(rows, items, now);

  it("counts requests, outcomes and open ones per gate, only for the filtered initiatives", () => {
    const b = r.gates.find((g) => g.gate === "B")!;
    expect(b).toMatchObject({ requested: 3, decided: 2, open: 1, fastLane: 1 });
    expect(b.outcomes).toMatchObject({ go: 1, go_with_conditions: 1, hold: 0, stop: 0 });
    expect(r.gates.find((g) => g.gate === "A")).toMatchObject({ requested: 1, decided: 1 });
    expect(r.gates.find((g) => g.gate === "C")).toMatchObject({ requested: 1, withdrawn: 1, open: 0 });
    expect(r.total).toBe(5);
  });

  it("measures the wait for a decision and the longest open request", () => {
    const b = r.gates.find((g) => g.gate === "B")!;
    expect(b.medianDaysToDecide).toBe(3); // 4 and 2 days
    expect(b.averageDaysToDecide).toBe(3);
    expect(b.longestOpenDays).toBe(10);
    expect(r.gates.find((g) => g.gate === "C")!.medianDaysToDecide).toBeNull();
  });

  it("measures the wait between Gate B and Start Building, and lists those still waiting", () => {
    expect(r.ready.passed).toBe(2);
    expect(r.ready.started).toBe(1);
    expect(r.ready.medianDays).toBe(5); // decided 5 Nov, started 10 Nov
    expect(r.ready.waiting).toEqual([{ id: "b", days: 16, pace: "unknown" }]);
  });

  it("uses the latest Gate B decision of an initiative", () => {
    const again = [...rows, req({ id: "7", item_id: "a", gate: "B", requested_at: "2026-11-06T00:00:00Z", decided_at: "2026-11-07T00:00:00Z", outcome: "hold" })];
    expect(gateReport(again, items, now).ready.passed).toBe(1);
  });

  it("is empty without requests", () => {
    const e = gateReport([], items, now);
    expect(e.total).toBe(0);
    expect(e.gates.every((g) => g.requested === 0 && g.medianDaysToDecide === null)).toBe(true);
    expect(e.ready.medianDays).toBeNull();
  });

  it("lists open requests oldest first, without a person", () => {
    expect(r.open).toEqual([{ id: "3", itemId: "c", gate: "B", days: 10, pace: "unknown" }]);
  });

  it("counts initiatives that asked at each gate and how many passed", () => {
    expect(r.funnel).toEqual([{ gate: "A", initiatives: 1, passed: 0 }, { gate: "B", initiatives: 3, passed: 2 }, { gate: "C", initiatives: 1, passed: 0 }]);
  });

  it("buckets the wait between Gate B and Start Building, started and still waiting", () => {
    expect(r.ready.buckets.find((b) => b.label === "3–7 days")).toEqual({ label: "3–7 days", started: 1, waiting: 0 });
    expect(r.ready.buckets.find((b) => b.label === "15–30 days")).toEqual({ label: "15–30 days", started: 0, waiting: 1 });
  });
});

describe("pace against what is usual", () => {
  const sp = spreadOf([2, 3, 3, 4, 4, 5, 5, 6, 7, 8])!;
  it("needs enough history", () => {
    expect(spreadOf([1, 2, 3, 4])).toBeNull();
    expect(paceOf(5, null)).toBe("unknown");
  });
  it("reads faster, usual, longer and attention from the quartiles and the high fence", () => {
    expect(paceOf(1, sp)).toBe("faster");
    expect(paceOf(4, sp)).toBe("usual");
    expect(paceOf(sp.q3 + 0.5, sp)).toBe("longer");
    expect(paceOf(sp.fence + 1, sp)).toBe("attention");
  });
  it("flags the long open request and the decided outlier of a gate with history", () => {
    const rows = [2, 3, 3, 4, 4, 5, 6].map((d, i) => req({ id: `h${i}`, item_id: "a", gate: "A", requested_at: "2026-09-01T00:00:00Z", decided_at: new Date(Date.parse("2026-09-01T00:00:00Z") + d * 86_400_000).toISOString(), outcome: "go" }))
      .concat([req({ id: "slow", item_id: "a", gate: "A", requested_at: "2026-09-01T00:00:00Z", decided_at: "2026-10-15T00:00:00Z", outcome: "go" }), req({ id: "open", item_id: "b", gate: "A", requested_at: "2026-10-01T00:00:00Z" })]);
    const rep = gateReport(rows, items, now);
    expect(rep.gates[0]!.outliers).toEqual([44]);
    expect(rep.open[0]).toMatchObject({ id: "open", gate: "A", days: 50, pace: "attention" });
  });
  it("says whether decisions lately are faster or slower than before", () => {
    const mk = (id: string, req0: string, d: number) => req({ id, item_id: "a", gate: "A", requested_at: req0, decided_at: new Date(Date.parse(req0) + d * 86_400_000).toISOString(), outcome: "go" });
    const old = [6, 7, 8, 8, 9].map((d, i) => mk(`o${i}`, "2026-08-01T00:00:00Z", d));
    const fast = [2, 2, 3].map((d, i) => mk(`n${i}`, "2026-11-10T00:00:00Z", d));
    expect(gateReport([...old, ...fast], items, now).gates[0]!.lately.signal).toBe("faster");
    expect(gateReport(old, items, now).gates[0]!.lately.signal).toBe("unknown");
  });
});
