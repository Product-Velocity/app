import { describe, expect, it } from "vitest";
import { bulkDecisionSummary, decisionGridRows, decisionsCsv, filterDecisionRows } from "./decision-grid";
import type { GateRequest } from "./gates";

const TODAY = new Date(Date.UTC(2027, 3, 14));
const req = (o: Partial<GateRequest> & Pick<GateRequest, "id" | "item_id">): GateRequest => ({
  gate: "B", kind: "decision", requested_by: "u2", requested_at: "2027-04-12T09:00:00Z", preferred_approvers: [], ready: false, criteria: [], outcome: null, rationale: null, fast_lane: false,
  target_phase: null, skipped_phases: [], review_date: null, decided_by: null, decided_at: null, withdrawn_at: null, ...o,
});
const items: Record<string, Record<string, unknown>> = {
  a: { item_code: "R-1", initiative_name: "Alpha", hypothesis: "Faster checkout converts", effort: "M", home_project: "p", initiative_phase: "Define", health: "On Track" },
  b: { item_code: "R-2", initiative_name: "Beta", initiative_phase: "Define", health: "Blocked" },
  c: { item_code: "R-3", initiative_name: "Gamma", initiative_phase: "Roll-out" },
};
const reqs = [
  req({ id: "r1", item_id: "a", requested_at: "2027-04-01T09:00:00Z" }),
  req({ id: "r2", item_id: "b", gate: "A", requested_by: null, criteria: [{ label: "x", ok: true }, { label: "y", ok: false }] }),
  req({ id: "r3", item_id: "c", outcome: "go", rationale: "Fine", decided_by: "u1", decided_at: "2027-04-13T09:00:00Z" }),
  req({ id: "r4", item_id: "c", kind: "skipped" }),
];
const rows = decisionGridRows(reqs, { today: TODAY, me: "u1", can: ["B"], item: (id) => items[id], docs: (id) => (id === "a" ? [{ kind: "prd", status: "approved" }] : []), email: (id) => (id ? `${id}@example.test` : "Not recorded") });

describe("the Decisions grid rows", () => {
  it("one row per decision request (skipped phases are not requests), with the wait of an open one", () => {
    expect(rows.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
    expect(rows[0]).toMatchObject({ state: "Waiting", daysWaiting: 13, overdue: true, code: "R-1", name: "Alpha", canDecide: true });
    expect(rows[1]).toMatchObject({ daysWaiting: 2, overdue: false, canDecide: false, requestedBy: "Not recorded" });
    expect(rows[2]).toMatchObject({ state: "Decided", daysWaiting: null, outcomeLabel: "Go", decidedBy: "u1@example.test", canDecide: false });
  });

  it("works the checklist out now when none was recorded, and uses the recorded one when there is one", () => {
    expect(rows[0]).toMatchObject({ checklistRecorded: false, checklistTotal: 6, checklistDone: 5, checklistComplete: false });
    expect(rows[1]).toMatchObject({ checklistRecorded: true, checklistDone: 1, checklistTotal: 2, checklistComplete: false });
  });

  it("filters by gate, outcome, wait, checklist and words", () => {
    expect(filterDecisionRows(rows, { gates: ["A"] }).map((r) => r.id)).toEqual(["r2"]);
    expect(filterDecisionRows(rows, { outcomes: ["go"] }).map((r) => r.id)).toEqual(["r3"]);
    expect(filterDecisionRows(rows, { overdue: true }).map((r) => r.id)).toEqual(["r1"]);
    expect(filterDecisionRows(rows, { incomplete: true }).map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(filterDecisionRows(rows, { canDecide: true }).map((r) => r.id)).toEqual(["r1"]);
    expect(filterDecisionRows(rows, { search: "checkout converts" }).map((r) => r.id)).toEqual(["r1"]);
    expect(filterDecisionRows(rows, { search: "u1@example.test" }).map((r) => r.id)).toEqual(["r3"]);
  });

  it("summarises a bulk decision: who can be decided, who cannot, how many checklists are incomplete", () => {
    const s = bulkDecisionSummary(rows.slice(0, 2));
    expect(s).toMatchObject({ total: 2, decidable: 1, notDecidable: 1, incomplete: 1, gates: ["B"] });
  });

  it("the CSV keeps the words and guards against formulas", () => {
    const csv = decisionsCsv(rows).split("\n");
    expect(csv[0]).toBe("Code,Initiative,Gate,State,Requested by,Requested,Days waiting,Checklist,Outcome,Decided by,Decided");
    expect(csv[1]).toContain("Gate B: Define to Build,Waiting");
    const evil = decisionGridRows([req({ id: "x", item_id: "e" })], { today: TODAY, me: null, can: [], item: () => ({ item_code: "R-9", initiative_name: "=cmd|' /C calc'!A0" }), docs: () => [], email: () => "x" });
    expect(decisionsCsv(evil).split("\n")[1]).toContain("'=cmd");
  });

  it("has no column or sort by approver speed (rule 8)", () => {
    expect(Object.keys(rows[0]!).filter((k) => /speed|average|slowest|performance/i.test(k))).toEqual([]);
  });
});
