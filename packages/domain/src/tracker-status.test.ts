import { describe, expect, it } from "vitest";
import { epicsStatusOf, trackerStatusOf } from "./tracker-status";

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

describe("Tracker Status of an initiative with only epics read from Jira (read-only project)", () => {
  it("says how many epics are done and gives the colour category", () => {
    expect(epicsStatusOf(["done", "indeterminate", "new"])).toEqual({ text: "1 of 3 epics done", category: "indeterminate" });
    expect(epicsStatusOf(["done", "done"])).toEqual({ text: "2 of 2 epics done", category: "done" });
    expect(epicsStatusOf(["new"])).toEqual({ text: "0 of 1 epic done", category: "new" });
  });
  it("counts an epic Jira did not classify as not done and leaves it out of the colour", () => {
    expect(epicsStatusOf([null, "done"])).toEqual({ text: "1 of 2 epics done", category: "done" });
    expect(epicsStatusOf([null])).toEqual({ text: "0 of 1 epic done", category: null });
  });
  it("is empty until an epic has been read", () => {
    expect(epicsStatusOf([])).toBeNull();
  });
});
