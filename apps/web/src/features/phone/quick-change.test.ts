import { describe, expect, it } from "vitest";
import { NOTE_MAX, noteRequired, quickChangeProblem, quickChangeText } from "./quick-change";

describe("noteRequired", () => {
  it("asks for a reason for a concern only", () => {
    for (const v of ["At Risk", "Delayed", "Blocked"]) expect(noteRequired("health", v)).toBe(true);
    expect(noteRequired("health", "On Track")).toBe(false);
    for (const v of ["On hold", "Cancelled"]) expect(noteRequired("initiative_status", v)).toBe(true);
    for (const v of ["Backlog", "Active", "Completed"]) expect(noteRequired("initiative_status", v)).toBe(false);
  });
});

describe("quickChangeProblem", () => {
  it("accepts a change that is allowed", () => {
    expect(quickChangeProblem("health", "On Track", "At Risk", "Vendor slipped the API")).toBeNull();
    expect(quickChangeProblem("health", "At Risk", "On Track", "")).toBeNull();
  });
  it("refuses no value, the same value, a missing or short reason and a long one", () => {
    expect(quickChangeProblem("health", "On Track", null, "")).toBe("Choose a value.");
    expect(quickChangeProblem("health", "On Track", "On Track", "")).toBe("It is already On Track.");
    expect(quickChangeProblem("health", "On Track", "Blocked", "  ")).toBe("Say why in a few words.");
    expect(quickChangeProblem("initiative_status", "Active", "On hold", "abc")).toBe("Say why in a few words.");
    expect(quickChangeProblem("health", "On Track", "On Track".replace("On Track", "At Risk"), "x".repeat(NOTE_MAX + 1))).toContain("at most");
  });
  it("lets an empty value become any value", () => expect(quickChangeProblem("health", null, "On Track", "")).toBeNull());
});

describe("quickChangeText", () => {
  it("words the change", () => {
    expect(quickChangeText("health", "On Track", "At Risk")).toBe("Health: On Track → At Risk");
    expect(quickChangeText("initiative_status", null, "Active")).toBe("Status: not set → Active");
  });
});
