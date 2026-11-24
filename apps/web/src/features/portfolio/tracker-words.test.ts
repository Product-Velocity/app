import { describe, expect, it } from "vitest";
import { trackerWords } from "./tracker-words";

describe("trackerWords: where the tracker columns come from", () => {
  it("only Jira projects: Jira", () => {
    expect(trackerWords({ trackers: { jira: true, projectTracker: { a: "jira", b: "jira", c: null } } })).toBe("Jira");
  });
  it("only GitHub projects: GitHub", () => {
    expect(trackerWords({ trackers: { jira: false, projectTracker: { a: "github" } } })).toBe("GitHub");
  });
  it("both in use: GitHub or Jira", () => {
    expect(trackerWords({ trackers: { jira: true, projectTracker: { a: "jira", b: "github" } } })).toBe("GitHub or Jira");
  });
  it("no project linked yet: what is connected", () => {
    expect(trackerWords({ trackers: { jira: true, projectTracker: {} } })).toBe("Jira");
    expect(trackerWords({ github: { connected: true, links: {} }, trackers: { jira: false, projectTracker: {} } })).toBe("GitHub");
    expect(trackerWords({ github: { connected: true, links: {} }, trackers: { jira: true, projectTracker: {} } })).toBe("GitHub or Jira");
    expect(trackerWords({})).toBe("GitHub or Jira");
  });
});

import { emptyTrackerText, rowTracker } from "./tracker-words";

describe("the empty words follow the initiative's tracker", () => {
  const l = { trackers: { jira: true, projectTracker: { pj: "jira" as const, pg: "github" as const, pn: null } }, jira: { links: { i1: { mode: "follow" as const, issueKey: "X-1", url: null, status: null, category: null, lastSynced: null } } }, github: { connected: true, links: {} } } as never;
  it("a Jira initiative is never 'Not on GitHub'", () => {
    expect(emptyTrackerText("status", "jira")).toBe("Not in Jira");
    expect(emptyTrackerText("status", "github")).toBe("Not on GitHub");
    expect(emptyTrackerText("status", null)).toBe("Not linked");
    expect(emptyTrackerText("gh_project_status", "jira")).toBe("GitHub only");
    expect(emptyTrackerText("gh_project_status", "github")).toBe("Not on a board");
    expect(emptyTrackerText("health", "jira")).toBeNull();
  });
  it("the tracker comes from the initiative's own link, else from its project", () => {
    expect(rowTracker(l, { id: "i1", home_project: "pg" })).toBe("jira"); // its own Jira link wins
    expect(rowTracker(l, { id: "i2", home_project: "pj" })).toBe("jira");
    expect(rowTracker(l, { id: "i3", home_project: "pg" })).toBe("github");
    expect(rowTracker(l, { id: "i4", home_project: "pn" })).toBeNull();
    expect(rowTracker(l, { id: "i5" })).toBeNull();
  });
});
