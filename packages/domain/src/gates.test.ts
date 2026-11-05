import { describe, expect, it } from "vitest";
import { phaseSuggestions, GATES, PHASES, checklistReady, decidableCount, filterQueue, gateChecklist, gateErrorText, gateOfPhase, isOpen, moveNeedsGate, movablePhases, requestableGates, splitForRequest, targetPhases, type GateRequest } from "./gates";

const req = (o: Partial<GateRequest>): GateRequest => ({ id: "r", item_id: "i", gate: "A", kind: "decision", requested_by: "u1", requested_at: "2026-11-05T10:00:00Z", preferred_approvers: [], ready: false, criteria: [], outcome: null, rationale: null, fast_lane: false, target_phase: null, skipped_phases: [], review_date: null, decided_by: null, decided_at: null, withdrawn_at: null, ...o });

describe("the lifecycle", () => {
  it("has the seven phases and three gates of the decision", () => {
    expect([...PHASES]).toEqual(["Discover", "Define", "Build", "Test", "Experiment", "Roll-out", "Completed"]);
    expect(Object.values(GATES).map((g) => `${g.id}:${g.from}>${g.to}`)).toEqual(["A:Discover>Define", "B:Define>Build", "C:Experiment>Roll-out"]);
  });
  it("names the gate an item has to pass next; an item without a phase starts at Discover", () => {
    expect(gateOfPhase("Discover")).toBe("A");
    expect(gateOfPhase(null)).toBe("A");
    expect(gateOfPhase("Define")).toBe("B");
    expect(gateOfPhase("Experiment")).toBe("C");
    for (const p of ["Build", "Test", "Roll-out", "Completed"]) expect(gateOfPhase(p), p).toBeNull();
  });
  it("offers the item's own gate and later ones (a jump), never a gate it is past", () => {
    expect(requestableGates("Discover")).toEqual(["A", "B", "C"]);
    expect(requestableGates("Define")).toEqual(["B", "C"]);
    expect(requestableGates("Build")).toEqual(["C"]);
    expect(requestableGates("Roll-out")).toEqual([]);
  });
});

describe("moves without a gate", () => {
  it("go back anywhere, forward only up to the next gate", () => {
    expect(movablePhases("Build")).toEqual(["Discover", "Define", "Test", "Experiment"]);
    expect(movablePhases("Experiment")).toEqual(["Discover", "Define", "Build", "Test"]);
    expect(movablePhases("Define")).toEqual(["Discover"]);
    expect(movablePhases("Completed")).toEqual([]);
  });
  it("names the gate a forward move would cross", () => {
    expect(moveNeedsGate("Define", "Build")).toBe("B");
    expect(moveNeedsGate("Build", "Roll-out")).toBe("C");
    expect(moveNeedsGate("Build", "Test")).toBeNull();
    expect(moveNeedsGate("Test", "Discover")).toBeNull();
  });
});

describe("the target of a Go", () => {
  it("is the next phase by default and a later one up to Roll-out is a fast lane", () => {
    expect(targetPhases("B", "Define")).toEqual([{ phase: "Build", fastLane: false }, { phase: "Test", fastLane: true }, { phase: "Experiment", fastLane: true }, { phase: "Roll-out", fastLane: true }]);
    expect(targetPhases("C", "Experiment")).toEqual([{ phase: "Roll-out", fastLane: false }]);
    expect(targetPhases("B", "Discover")[0]).toEqual({ phase: "Build", fastLane: true }); // skips Define
  });
});

describe("the checklist informs", () => {
  it("lists what is missing for gate B", () => {
    const list = gateChecklist("B", { initiative_name: "X", home_project: "p", hypothesis: "", effort: "M", moscow: null }, [{ kind: "prd", status: "draft" }]);
    expect(list.filter((c) => !c.ok).map((c) => c.label)).toEqual(["Hypothesis written", "MoSCoW set"]);
    expect(checklistReady(list)).toBe(false);
    expect(checklistReady(gateChecklist("A", { initiative_name: "X", home_project: "p", hypothesis: "h", kr_metric: "m" }, [{ kind: "discovery", status: "draft" }]))).toBe(true);
  });
});

describe("the queue", () => {
  const rows = [
    req({ id: "1", gate: "A", requested_at: "2026-11-01T10:00:00Z" }),
    req({ id: "2", gate: "B", requested_at: "2026-11-03T10:00:00Z", requested_by: "me" }),
    req({ id: "3", gate: "B", outcome: "go", decided_at: "2026-11-04T10:00:00Z", decided_by: "x" }),
    req({ id: "4", gate: "C", withdrawn_at: "2026-11-04T10:00:00Z" }),
    req({ id: "5", gate: "C", kind: "skipped", outcome: "go", decided_at: "2026-11-04T10:00:00Z" }),
  ];
  it("waiting shows open requests, newest first; withdrawn and skipped never", () => {
    expect(filterQueue(rows, "waiting", "me", []).map((r) => r.id)).toEqual(["2", "1"]);
    expect(rows.filter(isOpen).map((r) => r.id)).toEqual(["1", "2"]);
  });
  it("decided shows decisions only; mine shows my requests that were not withdrawn; can-decide follows the gates I hold", () => {
    expect(filterQueue(rows, "decided", "me", []).map((r) => r.id)).toEqual(["3"]);
    expect(filterQueue(rows, "mine", "me", []).map((r) => r.id)).toEqual(["2"]);
    expect(filterQueue(rows, "can-decide", "me", ["A"]).map((r) => r.id)).toEqual(["1"]);
    expect(filterQueue(rows, "can-decide", "me", ["A", "B", "C"]).map((r) => r.id)).toEqual(["2", "1"]);
    expect(decidableCount(rows, ["B"])).toBe(1);
    expect(decidableCount(rows, [])).toBe(0);
  });
});

describe("bulk requests", () => {
  it("splits a selection into items that can ask for the gate and items already past it, with the reason", () => {
    const items = [{ id: "a", initiative_phase: "Discover" }, { id: "b", initiative_phase: "Build" }, { id: "c", initiative_phase: null }];
    const { ready, skipped } = splitForRequest(items, "A");
    expect(ready.map((i) => i.id)).toEqual(["a", "c"]);
    expect(skipped).toEqual([{ item: items[1], reason: "already past gate A (Build)" }]);
  });
});

describe("error words", () => {
  it("explains the database's refusals", () => {
    expect(gateErrorText("PV006", "This request is already closed")).toBe("This request is already closed");
    expect(gateErrorText("PV006", "weird")).toBe("Someone else already handled this request.");
    expect(gateErrorText("PV004", "x")).toMatch(/Claude/);
    expect(gateErrorText("42501", "You do not have approval rights for gate B")).toMatch(/approval rights/);
    expect(gateErrorText(undefined, "boom")).toBe("boom");
  });
});

describe("suggestions, never automatic", () => {
  it("suggests Test when the tracker says the build is done, except for a cancelled initiative", () => {
    expect(phaseSuggestions({ initiative_phase: "Build", status: "Done" }, "2026-11-05")).toEqual([{ kind: "build-done", text: expect.stringContaining("Move to Test"), moveTo: "Test" }]);
    expect(phaseSuggestions({ initiative_phase: "Build", status: "In progress" }, "2026-11-05")).toEqual([]);
    expect(phaseSuggestions({ initiative_phase: "Test", status: "Done" }, "2026-11-05")).toEqual([]);
    expect(phaseSuggestions({ initiative_phase: "Build", status: "Done", initiative_status: "Cancelled" }, "2026-11-05")).toEqual([]);
  });
  it("reminds when a Hold's review date has come", () => {
    expect(phaseSuggestions({ gate_status: "Held", next_gate_due: "2026-11-05" }, "2026-11-05").map((s) => s.kind)).toEqual(["hold-due"]);
    expect(phaseSuggestions({ gate_status: "Held", next_gate_due: "2026-12-01" }, "2026-11-05")).toEqual([]);
  });
});
