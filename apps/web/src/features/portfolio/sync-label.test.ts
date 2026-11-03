import { describe, expect, it } from "vitest";
import { connectedPlatforms, syncLabel, syncPlatforms, syncTitle } from "./sync-label";

const l = (github: boolean, jira: boolean, projectTracker: Record<string, "github" | "jira" | null> = {}) => ({ github: { connected: github, links: {} }, trackers: { jira, projectTracker } });

describe("the Sync button names the connected platform", () => {
  it("only Jira connected: Jira, never GitHub", () => {
    expect(syncPlatforms(l(false, true), ["p1"])).toEqual(["Jira"]);
    expect(syncLabel(syncPlatforms(l(false, true), []), 0)).toBe("Sync with Jira");
    expect(syncLabel(syncPlatforms(l(false, true), []), 3)).toBe("Sync 3 with Jira");
  });
  it("only GitHub connected: GitHub", () => {
    expect(syncLabel(syncPlatforms(l(true, false), ["p1"]))).toBe("Sync with GitHub");
  });
  it("both connected: the platforms of the projects in scope", () => {
    const x = l(true, true, { a: "jira", b: "github", c: null });
    expect(syncPlatforms(x, ["a"])).toEqual(["Jira"]);
    expect(syncPlatforms(x, ["b", "c"])).toEqual(["GitHub"]);
    expect(syncPlatforms(x, ["a", "b"])).toEqual(["GitHub", "Jira"]);
    expect(syncLabel(syncPlatforms(x, ["a", "b"]), 2)).toBe("Sync 2 with GitHub and Jira");
  });
  it("a scope with none of the connected platforms names the connected ones; nothing connected says so", () => {
    expect(syncPlatforms(l(false, true, { a: "github" }), ["a"])).toEqual(["Jira"]);
    expect(syncPlatforms(l(false, false), ["a"])).toEqual([]);
    expect(syncLabel([])).toBe("Sync with GitHub or Jira");
    expect(syncTitle([])).toMatch(/connects GitHub or Jira/);
    expect(syncTitle(["Jira"])).toMatch(/^Checks Jira for changes/);
    expect(connectedPlatforms({})).toEqual([]);
  });
});
