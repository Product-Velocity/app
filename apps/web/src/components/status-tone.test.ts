import { describe, expect, it } from "vitest";
import { statusTone } from "./status-tone";

describe("statusTone", () => {
  it.each([
    ["On track", "good"], ["Done", "good"], ["Go", "good"], ["Passing", "good"], ["Exceeded", "good"],
    ["At risk", "risk"], ["Go with conditions", "risk"], ["Hold", "risk"], ["Waiting for Approver", "risk"], ["Contested", "risk"],
    ["Blocked", "bad"], ["Delayed", "bad"], ["Stop", "bad"], ["Kill", "bad"], ["Failing", "bad"], ["Overdue", "bad"],
    ["In progress", "info"],
    ["Not started", "neutral"], ["Cancelled", "neutral"], ["On hold", "neutral"], ["Not yet decided", "neutral"], ["Something new", "neutral"],
  ])("%s is %s", (v, tone) => expect(statusTone(v)).toBe(tone));
  it("ignores case and spaces", () => expect(statusTone("  ON TRACK ")).toBe("good"));
});
