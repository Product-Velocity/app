import { describe, expect, it } from "vitest";
import { trackerNameOf } from "./item-panel";
import type { Lookups } from "./types";

const base: Lookups = { projects: [], members: [] };
const jiraLink = { mode: "follow" as const, issueKey: "SCRUM-1", url: "https://x.atlassian.net/browse/SCRUM-1", status: null, category: null, lastSynced: null };
const ghLink = { mode: "push" as const, number: 5, url: "https://github.com/a/b/issues/5", state: "synced" as const, error: null, ghState: "open" as const, lastActivity: null };

describe("which tracker the item panel names", () => {
  it("the tracker the initiative is linked to, then the project's, and GitHub when nothing is known", () => {
    expect(trackerNameOf({ ...base, jira: { links: { i: jiraLink } } }, "i", "p")).toBe("Jira");
    expect(trackerNameOf({ ...base, github: { connected: true, links: { i: ghLink } }, jira: { links: { i: jiraLink } } }, "i", "p")).toBe("GitHub");
    expect(trackerNameOf({ ...base, trackers: { jira: true, projectTracker: { p: "jira" } } }, "i", "p")).toBe("Jira");
    expect(trackerNameOf({ ...base, trackers: { jira: true, projectTracker: { p: "github" } } }, "i", "p")).toBe("GitHub");
    expect(trackerNameOf(base, "i", undefined)).toBe("GitHub");
  });
});
