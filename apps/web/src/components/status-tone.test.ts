import { describe, expect, it } from "vitest";
import { phaseTone, statusTone, toneFor } from "./status-tone";

describe("statusTone", () => {
  it.each([
    ["On track", "good"], ["Done", "good"], ["Go", "good"], ["Passing", "good"], ["Exceeded", "good"],
    ["At risk", "risk"], ["Go with conditions", "risk"], ["Hold", "risk"], ["Waiting for Approver", "risk"], ["Contested", "risk"],
    ["Blocked", "severe"], ["Delayed", "bad"], ["Stop", "bad"], ["Kill", "bad"], ["Failing", "bad"], ["Overdue", "bad"],
    ["In progress", "info"], ["Active", "info"], ["Included", "info"], ["On hold", "risk"], ["Deferred", "risk"], ["Completed", "good"],
    ["Not started", "neutral"], ["Cancelled", "neutral"], ["Backlog", "neutral"], ["Candidate", "neutral"], ["Dropped", "neutral"], ["Not yet decided", "neutral"], ["Something new", "neutral"],
  ])("%s is %s", (v, tone) => expect(statusTone(v)).toBe(tone));
  it("phases are outlined, never filled, and Completed and Sunset are muted", () => {
    for (const p of ["Discover", "Define", "Build", "Test", "Experiment", "Roll-out"]) expect(phaseTone(p)).toBe("stage");
    expect(phaseTone("Completed")).toBe("stage-muted");
    expect(phaseTone("Sunset")).toBe("stage-muted");
    expect(toneFor("initiative_phase", "Completed")).toBe("stage-muted");
    expect(toneFor("initiative_status", "Completed")).toBe("good");
  });
  it("ignores case and spaces", () => expect(statusTone("  ON TRACK ")).toBe("good"));
});
