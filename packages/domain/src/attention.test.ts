import { describe, expect, it } from "vitest";
import { ATTENTION_KINDS, attentionCounts, attentionList, filterAttention } from "./attention";
import type { GateRequest } from "./gates";

const TODAY = new Date(Date.UTC(2027, 3, 14)); // 14 Apr 2027
const row = (n: number, o: Record<string, unknown> = {}) => ({ id: `i${n}`, item_code: `R-${n}`, initiative_name: `Item ${n}`, stack_rank: n, initiative_status: "Active", health: "On Track", ...o });
const req = (o: Partial<GateRequest>): GateRequest => ({ id: "r", item_id: "i1", gate: "B", kind: "decision", requested_by: "u", requested_at: "2027-04-01T10:00:00Z", preferred_approvers: [], ready: false, criteria: [], outcome: null, rationale: null, fast_lane: false, target_phase: null, skipped_phases: [], review_date: null, decided_by: null, decided_at: null, withdrawn_at: null, ...o });
const kinds = (e: { reasons: { kind: string }[] }[]) => e.flatMap((x) => x.reasons.map((r) => r.kind));

describe("what needs attention", () => {
  it("says nothing about a healthy, recent initiative", () => {
    expect(attentionList([row(1, { initiative_phase: "Build", status: "In progress", phase_changed_at: "2027-04-01" })], TODAY)).toEqual([]);
  });

  it("suggests Test when the tracker says the build is done, with a one-click action", () => {
    const [e] = attentionList([row(1, { initiative_phase: "Build", status: "Done" })], TODAY);
    expect(e!.reasons).toEqual([expect.objectContaining({ kind: "build-done", action: { type: "move", to: "Test", label: "Move to Test" } })]);
  });

  it("flags tracker work that started before the gate, and offers the gate", () => {
    const [e] = attentionList([row(1, { initiative_phase: "Define", status: "In progress" })], TODAY);
    expect(e!.reasons[0]).toMatchObject({ kind: "tracker-early", action: { type: "request-gate", gate: "B" } });
    expect(e!.reasons[0]!.text).toMatch(/before gate B/);
    expect(attentionList([row(2, { initiative_phase: "Discover", status: "Done" })], TODAY)[0]!.reasons[0]!.text).toMatch(/before gate B/);
  });

  it("flags a cancelled initiative whose build is still going, at the top, and ignores other finished ones", () => {
    const list = attentionList([row(1, { initiative_status: "Cancelled", status: "In progress", initiative_phase: "Build" }), row(2, { initiative_status: "Cancelled", status: "Done" }), row(3, { initiative_status: "Completed", initiative_phase: "Build", status: "Done" })], TODAY);
    expect(list.map((e) => e.code)).toEqual(["R-1"]);
    expect(list[0]).toMatchObject({ tier: 0 });
  });

  it("reminds when a Hold's review date has come", () => {
    const [e] = attentionList([row(1, { initiative_phase: "Define", gate_status: "Held", next_gate_due: "2027-04-14" })], TODAY);
    expect(e!.reasons[0]).toMatchObject({ kind: "hold-due", action: { type: "request-gate", gate: "B" } });
    expect(attentionList([row(1, { initiative_phase: "Define", gate_status: "Held", next_gate_due: "2027-05-01" })], TODAY)).toEqual([]);
  });

  it("flags a gate request that has waited more than a week, never a withdrawn or decided one", () => {
    const rows = [row(1, { initiative_phase: "Define" })];
    expect(kinds(attentionList(rows, TODAY, { requests: [req({})] }))).toEqual(["gate-waiting"]); // 13 days
    expect(attentionList(rows, TODAY, { requests: [req({ requested_at: "2027-04-10T10:00:00Z" })] })).toEqual([]); // 4 days
    expect(attentionList(rows, TODAY, { requests: [req({ withdrawn_at: "2027-04-02T10:00:00Z" })] })).toEqual([]);
    expect(attentionList(rows, TODAY, { requests: [req({ outcome: "go", decided_at: "2027-04-02T10:00:00Z" })] })).toEqual([]);
    expect(attentionList(rows, TODAY, { requests: [req({})] })[0]!.reasons[0]).toMatchObject({ days: 13, action: { type: "decisions" } });
  });

  it("lists open conditions", () => {
    const [e] = attentionList([row(1)], TODAY, { conditions: [{ item_id: "i1", text: "Legal review" }, { item_id: "i1", text: "Privacy note" }, { item_id: "i1", text: "Pricing" }] });
    expect(e!.reasons[0]).toMatchObject({ kind: "conditions" });
    expect(e!.reasons[0]!.text).toMatch(/^3 open conditions: Legal review; Privacy note; …/);
  });

  it("flags an Active initiative that stayed in a phase longer than the limit, but not one on hold or past a Hold", () => {
    expect(kinds(attentionList([row(1, { initiative_phase: "Define", phase_changed_at: "2027-02-01" })], TODAY))).toEqual(["stalled"]);
    expect(attentionList([row(1, { initiative_phase: "Build", phase_changed_at: "2027-02-01" })], TODAY)).toEqual([]); // 72 days, limit 90
    expect(attentionList([row(1, { initiative_phase: "Define", phase_changed_at: "2027-02-01", initiative_status: "On hold" })], TODAY)).toEqual([]);
    expect(attentionList([row(1, { initiative_phase: "Define", phase_changed_at: "2027-02-01", gate_status: "Held" })], TODAY)).toEqual([]);
  });

  it("includes the delivery risks of the leadership view and puts blocked work first, then by rank", () => {
    const list = attentionList([row(1, { health: "At Risk" }), row(2, { health: "Blocked" }), row(3, { health: "Delayed" })], TODAY);
    expect(list.map((e) => e.code)).toEqual(["R-2", "R-3", "R-1"]);
    expect(list.map((e) => e.tier)).toEqual([0, 1, 2]);
  });

  it("puts several reasons on one entry and counts each kind once per initiative", () => {
    const list = attentionList([row(1, { initiative_phase: "Build", status: "Done", health: "At Risk" }), row(2, { initiative_phase: "Build", status: "Done" })], TODAY);
    expect(list).toHaveLength(2);
    expect(list[0]!.reasons.map((r) => r.kind).sort()).toEqual(["build-done", "delivery-risk"]);
    const counts = attentionCounts(list);
    expect(counts["build-done"]).toBe(2);
    expect(counts["delivery-risk"]).toBe(1);
    expect(filterAttention(list, "delivery-risk").map((e) => e.code)).toEqual(["R-1"]);
    expect(filterAttention(list, "all")).toHaveLength(2);
    expect(Object.keys(counts)).toEqual(ATTENTION_KINDS.map((k) => k.id));
  });

  it("ignores requests and conditions of initiatives that are not in the rows (another scope)", () => {
    expect(attentionList([row(2)], TODAY, { requests: [req({ item_id: "i1" })], conditions: [{ item_id: "i1", text: "x" }] })).toEqual([]);
  });
});
