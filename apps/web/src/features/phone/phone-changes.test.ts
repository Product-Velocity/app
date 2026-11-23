import { describe, expect, it } from "vitest";
import type { ChangeRowData } from "@pv/domain";
import { ago, changeText, latestChangedInitiatives, trackerChanges } from "./phone-changes";

let n = 0;
const row = (o: Partial<ChangeRowData>): ChangeRowData => ({
  kind: "change", id: `c${++n}`, entryId: n, itemId: "i1", code: "R-1", name: "Self-serve onboarding", at: "2026-11-23T10:00:00Z", type: "health", from: "On track", to: "At risk",
  tone: "risk", fromTone: "good", source: "Product Velocity", sourceType: "UI", trackerDriven: false, actorId: null, actor: "the system", by: "the system", tracker: null,
  flags: [], issue: null, alsoBuild: null, jiraUser: null, ...o,
});

describe("latestChangedInitiatives", () => {
  it("keeps the newest change per initiative and counts the rest", () => {
    const rows = [row({ at: "2026-11-23T10:00:00Z" }), row({ type: "phase", from: "Define", to: "Build", at: "2026-11-22T10:00:00Z" }), row({ itemId: "i2", code: "R-2", at: "2026-11-21T10:00:00Z" })];
    const out = latestChangedInitiatives(rows);
    expect(out.map((c) => c.code)).toEqual(["R-1", "R-2"]);
    expect(out[0]).toMatchObject({ label: "Health", more: 1 });
  });
  it("leaves tracker-driven changes to the Tracker feed", () => {
    expect(latestChangedInitiatives([row({ type: "build-status", trackerDriven: true }), row({ type: "issue-status", trackerDriven: true })])).toEqual([]);
  });
  it("puts followed initiatives first and keeps them even when newer changes fill the list", () => {
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => row({ itemId: `n${i}`, code: `R-${i}`, at: `2026-11-23T10:${String(59 - i).padStart(2, "0")}:00Z` })),
      row({ itemId: "f1", code: "R-90", at: "2026-11-01T10:00:00Z" }), row({ itemId: "f2", code: "R-91", at: "2026-11-02T10:00:00Z" }),
    ];
    const out = latestChangedInitiatives(rows, 15, new Set(["f1", "f2"]));
    expect(out).toHaveLength(15);
    expect(out.slice(0, 2).map((c) => c.code)).toEqual(["R-90", "R-91"]);
    expect(out[2]!.code).toBe("R-0");
  });
  it("stops at the limit", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row({ itemId: `x${i}`, code: `R-${i}` }));
    expect(latestChangedInitiatives(rows)).toHaveLength(15);
    expect(latestChangedInitiatives(rows, 3)).toHaveLength(3);
  });
});

describe("trackerChanges", () => {
  const issue = { tracker: "Jira" as const, key: "R8P-7049", title: "Payment retries", url: null };
  const rows = [
    row({ type: "issue-status", trackerDriven: true, source: "Jira", tracker: "Jira", issue, from: "To Do", to: "Done", code: "R-7" }),
    row({ type: "health" }),
    row({ type: "build-status", trackerDriven: true, source: "GitHub", code: "R-9", name: "Billing", from: "Not started", to: "In progress" }),
  ];
  it("lists only what the tracker changed", () => expect(trackerChanges(rows).map((c) => c.code)).toEqual(["R-7", "R-9"]));
  it("searches issue key, issue title, initiative and status", () => {
    expect(trackerChanges(rows, "r8p-7049").map((c) => c.code)).toEqual(["R-7"]);
    expect(trackerChanges(rows, "payment retries").map((c) => c.code)).toEqual(["R-7"]);
    expect(trackerChanges(rows, "billing progress").map((c) => c.code)).toEqual(["R-9"]);
    expect(trackerChanges(rows, "nothing like this")).toEqual([]);
  });
  it("stops at ten", () => expect(trackerChanges(Array.from({ length: 25 }, () => rows[0]!))).toHaveLength(10));
});

describe("words", () => {
  const now = new Date("2026-11-23T12:00:00Z");
  it("says how long ago", () => {
    expect(ago("2026-11-23T11:59:30Z", now)).toBe("just now");
    expect(ago("2026-11-23T11:55:00Z", now)).toBe("5 min ago");
    expect(ago("2026-11-23T09:00:00Z", now)).toBe("3 h ago");
    expect(ago("2026-11-22T09:00:00Z", now)).toBe("yesterday");
    expect(ago("2026-11-19T09:00:00Z", now)).toBe("4 days ago");
  });
  it("words a change", () => {
    expect(changeText({ label: "Health", from: "On track", to: "At risk" })).toBe("Health: On track → At risk");
    expect(changeText({ label: "Health", from: null, to: "At risk" })).toBe("Health: At risk");
  });
});
