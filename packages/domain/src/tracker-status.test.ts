import { describe, expect, it } from "vitest";
import { trackerStatusOf } from "./tracker-status";

describe("Tracker Status: the tracker's own words", () => {
  it("Jira: the status name as Jira spells it", () => {
    expect(trackerStatusOf({ jiraStatus: "In Review" })).toBe("In Review");
    expect(trackerStatusOf({ jiraStatus: "  Project Closed " })).toBe("Project Closed");
  });
  it("GitHub: the board's Status first, otherwise the state of the issue", () => {
    expect(trackerStatusOf({ boardStatus: "On staging", ghState: "open" })).toBe("On staging");
    expect(trackerStatusOf({ ghState: "open" })).toBe("Open");
    expect(trackerStatusOf({ ghState: "closed_completed" })).toBe("Closed");
    expect(trackerStatusOf({ ghState: "closed_not_planned" })).toBe("Closed (not planned)");
  });
  it("is empty for an initiative with no tracker, a blank status or a state it does not know", () => {
    expect(trackerStatusOf({})).toBeNull();
    expect(trackerStatusOf({ jiraStatus: "  ", boardStatus: "", ghState: null })).toBeNull();
    expect(trackerStatusOf({ ghState: "merged" })).toBeNull();
  });
  it("Jira wins when an initiative has both", () => {
    expect(trackerStatusOf({ jiraStatus: "Done", boardStatus: "Backlog", ghState: "open" })).toBe("Done");
  });
});
