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

import { changeGridRows, changeTone, isChangeHeader, type ChangeFlag, type ChangeRowData } from "./change-report";

describe("changeTone", () => {
  it("colours the value a change ended on, and never guesses a Jira status", () => {
    expect(changeTone("health", "At Risk")).toBe("risk");
    expect(changeTone("health", "Blocked")).toBe("bad");
    expect(changeTone("health", "On Track")).toBe("good");
    expect(changeTone("build-status", "Done")).toBe("good");
    expect(changeTone("initiative-status", "Cancelled")).toBe("bad");
    expect(changeTone("phase", "Test")).toBe("info");
    expect(changeTone("issue-status", "Closed", "GitHub")).toBe("good");
    expect(changeTone("issue-status", "Project Accepted", "Jira")).toBe("neutral"); // Jira counts it as To Do; the name says nothing
    expect(changeTone("issue-status", "Project Closed", "Jira")).toBe("neutral");
  });
});

describe("changeGridRows", () => {
  const feed2 = [
    row("a", "items", "initiative_status", "Active", "Completed", "2026-11-17T12:30:00Z"),
    row("a", "item_jira_links", "jira_status", "Project Execution", "Project Closed", "2026-11-17T12:18:00Z", { actor_id: null, via: "system" }),
    row("b", "items", "health", "On Track", "At Risk", "2026-11-16T12:00:00Z"),
  ];
  const groups = changeReport(feed2, items);
  const flag: ChangeFlag = { kind: "build-done", label: "Build done", text: "All 3 linked issues are closed." };
  const flags = new Map([["a", [flag]]]);

  it("puts a header before each initiative with the count, the flags and whether it moved", () => {
    const rows = changeGridRows(groups, "initiative", new Set(), flags);
    expect(rows.map((r) => (isChangeHeader(r) ? "group" : r.kind))).toEqual(["group", "change", "change", "group", "change"]);
    const h = rows[0]!;
    expect(isChangeHeader(h) && h).toMatchObject({ __group: true, key: "initiative:a", label: "R-27 Bidder adapter", count: 2, unit: "changes", level: 0 });
    expect((h as { badges: { text: string; tone: string }[] }).badges).toEqual([expect.objectContaining({ text: "Initiative: Status", tone: "info" }), expect.objectContaining({ text: "1 linked-issue change" }), expect.objectContaining({ text: "⚑ Build done", tone: "risk", title: flag.text })]);
    expect(rows[1]).toMatchObject({ code: "R-27", tone: "good", flags: [flag] });
  });

  it("a collapsed group shows only its header", () => {
    const rows = changeGridRows(groups, "initiative", new Set(["initiative:a"]), flags);
    expect(rows.map((r) => (isChangeHeader(r) ? "group" : r.kind))).toEqual(["group", "group", "change"]);
    expect((rows[0] as { collapsed: boolean }).collapsed).toBe(true); // the main grid's collapse key, so one toggle works for both grids
  });

  it("groups by change type in the order of the list, by day newest first, or not at all (newest first)", () => {
    const byType = changeGridRows(groups, "type", new Set());
    expect(byType.filter(isChangeHeader).map((h) => h.label)).toEqual(["Status", "Health", "Linked issue"]);
    const byDay = changeGridRows(groups, "day", new Set());
    expect(byDay.filter(isChangeHeader)).toHaveLength(2);
    expect(byDay.filter((r): r is ChangeRowData => !isChangeHeader(r)).map((r) => r.at)).toEqual(["2026-11-17T12:30:00Z", "2026-11-17T12:18:00Z", "2026-11-16T12:00:00Z"]);
    expect(changeGridRows(groups, "none", new Set()).some(isChangeHeader)).toBe(false);
  });

  it("keeps only flagged initiatives when asked", () => {
    const rows = changeGridRows(groups, "initiative", new Set(), flags, true);
    expect(new Set(rows.filter((r) => !isChangeHeader(r)).map((r) => (r as { itemId: string }).itemId))).toEqual(new Set(["a"]));
  });
});
