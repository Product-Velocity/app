import { describe, expect, it } from "vitest";
import { changeCounts, changePeriod, changeReport, changeTypeOf, type FeedRow, type ItemInfo } from "./change-report";

const items = new Map<string, ItemInfo>([["a", { code: "R-27", name: "Bidder adapter", rank: 2 }], ["b", { code: "G-03", name: "Manager onboarding", rank: 1 }]]);
let id = 0;
const row = (item: string, entity: string, field: string, old: unknown, next: unknown, at: string, extra: Partial<FeedRow> = {}): FeedRow => ({ id: ++id, item_id: item, entity, field, old, new: next, at, actor_id: "u1", via: "UI", ...extra });

describe("changeTypeOf", () => {
  it("maps the audited fields to the five change types and ignores everything else", () => {
    expect(changeTypeOf({ entity: "items", field: "initiative_phase" })).toBe("phase");
    expect(changeTypeOf({ entity: "items", field: "initiative_status" })).toBe("initiative-status");
    expect(changeTypeOf({ entity: "items", field: "health" })).toBe("health");
    expect(changeTypeOf({ entity: "items", field: "status" })).toBe("build-status");
    expect(changeTypeOf({ entity: "item_jira_links", field: "jira_status" })).toBe("issue-status");
    expect(changeTypeOf({ entity: "item_github_links", field: "gh_state" })).toBe("issue-status");
    expect(changeTypeOf({ entity: "items", field: "value_12m" })).toBeNull(); // commercial fields are never part of it
    expect(changeTypeOf({ entity: "item_jira_links", field: "jira_updated_at" })).toBeNull();
  });
});

describe("changeReport", () => {
  const feed = [
    row("a", "items", "initiative_status", "Active", "Completed", "2026-11-17T09:30:00Z", { actor_id: "u2" }),
    row("a", "item_jira_links", "jira_status", "Project Execution", "Project Closed", "2026-11-17T09:18:00Z", { actor_id: null, via: "system" }),
    row("a", "items", "status", "In progress", "Done", "2026-11-17T09:18:01Z", { actor_id: null, via: "system" }),
    row("b", "items", "health", "On Track", "At Risk", "2026-11-17T11:00:00Z"),
    row("zzz", "items", "health", "On Track", "Blocked", "2026-11-17T12:00:00Z"), // not in the filtered rows
  ];

  it("groups by initiative, newest group first, entries newest first, with time, source and actor", () => {
    const g = changeReport(feed, items);
    expect(g.map((x) => x.code)).toEqual(["G-03", "R-27"]);
    expect(g[1]!.entries.map((e) => e.type)).toEqual(["initiative-status", "build-status", "issue-status"]);
    expect(g[1]!.entries[0]).toMatchObject({ at: "2026-11-17T09:30:00Z", actorId: "u2", via: "UI", from: "Active", to: "Completed" });
    expect(g[1]!.entries[2]).toMatchObject({ tracker: "Jira", via: "system", actorId: null });
  });

  it("says whether the initiative itself moved, apart from the linked issues", () => {
    const [b, a] = changeReport(feed, items);
    expect(b!.moved).toEqual(["health"]);
    expect(b!.trackerChanges).toBe(0);
    expect(a!.moved).toEqual(["initiative-status"]);
    expect(a!.trackerChanges).toBe(2);
    const onlyTracker = changeReport(feed, items, ["issue-status"]);
    expect(onlyTracker).toHaveLength(1);
    expect(onlyTracker[0]!.moved).toEqual([]); // an initiative that did not move shows only its ticket activity
    expect(onlyTracker[0]!.entries).toHaveLength(1);
  });

  it("keeps only the chosen types and drops initiatives left with nothing", () => {
    expect(changeReport(feed, items, ["health"]).map((g) => g.code)).toEqual(["G-03"]);
    expect(changeReport(feed, items, ["phase"])).toEqual([]);
  });

  it("shows GitHub states in words, and skips a row that did not change", () => {
    const g = changeReport([row("a", "item_github_links", "gh_state", "open", "closed_completed", "2026-11-17T10:00:00Z"), row("a", "items", "health", "On Track", "On Track", "2026-11-17T10:01:00Z")], items);
    expect(g[0]!.entries).toHaveLength(1);
    expect(g[0]!.entries[0]).toMatchObject({ from: "Open", to: "Closed", tracker: "GitHub" });
  });

  it("counts per type for the chips, only for initiatives that are shown", () => {
    expect(changeCounts(feed, items)).toEqual({ phase: 0, "initiative-status": 1, health: 1, "build-status": 1, "issue-status": 1 });
  });
});

describe("changePeriod", () => {
  const now = new Date(2026, 10, 17, 14, 5); // Tuesday 17 Nov 2026, local time
  it("today runs from midnight to the next midnight", () => {
    const p = changePeriod("today", now);
    expect(p.from).toEqual(new Date(2026, 10, 17));
    expect(p.to).toEqual(new Date(2026, 10, 18));
  });
  it("the week starts on Monday and the month on the 1st", () => {
    expect(changePeriod("week", now).from).toEqual(new Date(2026, 10, 16));
    expect(changePeriod("week", new Date(2026, 10, 22, 9)).from).toEqual(new Date(2026, 10, 16)); // Sunday belongs to the week before
    expect(changePeriod("month", now).from).toEqual(new Date(2026, 10, 1));
    expect(changePeriod("month", now).to).toEqual(new Date(2026, 10, 18));
  });
});
