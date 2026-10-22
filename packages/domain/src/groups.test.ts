import { describe, expect, it } from "vitest";
import { cleanGroupName, groupKey, nearDuplicates, resolveGroup, suggestGroups } from "./groups";

const existing = ["Onboarding", "Retention", "Platform health", "Growth"];

describe("groupKey", () => {
  it("ignores case, spaces and punctuation", () => {
    expect(groupKey("On-boarding")).toBe("onboarding");
    expect(groupKey("  ONBOARDING ")).toBe("onboarding");
    expect(groupKey("Platform  health!")).toBe("platformhealth");
  });
});

describe("cleanGroupName", () => {
  it("trims and collapses spaces, and refuses an empty or over-long name", () => {
    expect(cleanGroupName("  Customer   onboarding ")).toEqual({ ok: true, name: "Customer onboarding" });
    expect(cleanGroupName("   ")).toEqual({ ok: false, error: "Type a group name." });
    expect(cleanGroupName("x".repeat(121))).toEqual({ ok: false, error: "Keep the group name under 120 characters." });
  });
});

describe("resolveGroup", () => {
  it("uses the existing spelling when only the case or the spacing around it differs", () => {
    expect(resolveGroup("onboarding", existing)).toEqual({ kind: "existing", name: "Onboarding" });
    expect(resolveGroup("  PLATFORM  HEALTH", existing)).toEqual({ kind: "existing", name: "Platform health" });
  });
  it("creates a new group for an unknown name and warns about look-alikes", () => {
    expect(resolveGroup("On-boarding", existing)).toEqual({ kind: "new", name: "On-boarding", similar: ["Onboarding"] });
    expect(resolveGroup("Onbording", existing)).toEqual({ kind: "new", name: "Onbording", similar: ["Onboarding"] });
    expect(resolveGroup("Billing", existing)).toEqual({ kind: "new", name: "Billing", similar: [] });
  });
  it("is empty for blank input", () => {
    expect(resolveGroup("  ", existing)).toEqual({ kind: "empty" });
  });
});

describe("nearDuplicates", () => {
  it("matches the same letters or one typo, but not short or unrelated names", () => {
    expect(nearDuplicates("Re-tention", existing)).toEqual(["Retention"]);
    expect(nearDuplicates("Grow", existing)).toEqual([]);
    expect(nearDuplicates("Growth", existing)).toEqual([]); // the same group, not a look-alike
  });
});

describe("suggestGroups", () => {
  it("lists groups that start with, then contain, what was typed, in the workspace's spelling", () => {
    expect(suggestGroups("", existing)).toEqual(["Growth", "Onboarding", "Platform health", "Retention"]);
    expect(suggestGroups("ret", existing)).toEqual(["Retention"]);
    expect(suggestGroups("health", existing)).toEqual(["Platform health"]);
    expect(suggestGroups("on", existing)).toEqual(["Onboarding", "Retention"]); // starts with, then contains
  });
});
