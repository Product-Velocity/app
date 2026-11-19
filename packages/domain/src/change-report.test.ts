import { describe, expect, it } from "vitest";
import {
  buildChangeRows, jiraCategoryTone, changeFieldChoices, changeFilterCount, changeFlags, changeGroupSummary, changePeriod, changeTone, changeTypeOf, filterChangeRows, groupChangeRows,
  isChangeHeader, matchesChangeSearch, NO_CHANGE_FILTERS, type ChangeFlag, type ChangeRowData, type FeedRow, type ItemInfo, type TrackerRef,
} from "./change-report";

const items = new Map<string, ItemInfo>([["a", { code: "R-27", name: "Bidder adapter", rank: 2 }], ["b", { code: "G-03", name: "Manager onboarding", rank: 1 }]]);
let id = 0;
const row = (item: string, entity: string, field: string, old: unknown, next: unknown, at: string, extra: Partial<FeedRow> = {}): FeedRow => ({ id: ++id, item_id: item, entity, field, old, new: next, at, actor_id: "u1", via: "UI", ...extra });
const names: Record<string, string> = { u1: "Ana", u2: "Ben" };
const nameOf = (a: string | null) => (a ? names[a] ?? "someone" : "the system");

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

describe("changeFlags (real data: initiatives pulled in from Jira usually have no phase or status)", () => {
  const TODAY = new Date(Date.UTC(2026, 10, 17));
  const r = (id: string, o: Record<string, unknown> = {}) => ({ id, item_code: id, initiative_name: id, stack_rank: 1, initiative_status: null, initiative_phase: null, health: "On Track", ...o });

  it("flags a Jira epic that is done while the initiative has no phase and is not Completed (the R-27 case)", () => {
    const f = changeFlags([r("a", { status: "Done" })], TODAY).get("a")!;
    expect(f).toEqual([expect.objectContaining({ kind: "tracker-done-open", label: "Tracker done, initiative open" })]);
    expect(f[0]!.text).toMatch(/no phase and its status is not set/);
    expect(changeFlags([r("b", { status: "In progress", issues_total: 3, issues_closed: 3 })], TODAY).get("b")![0]!.text).toMatch(/all 3 linked issues are closed/);
    expect(changeFlags([r("c", { status: "Done", initiative_status: "Active" })], TODAY).get("c")![0]!.text).toMatch(/status is Active, not Completed/);
  });

  it("flags a build in progress with no phase, and nothing for finished, not started or phased initiatives", () => {
    expect(changeFlags([r("a", { status: "In progress" })], TODAY).get("a")![0]).toMatchObject({ kind: "no-phase" });
    expect(changeFlags([r("a", { status: "Not started" })], TODAY).has("a")).toBe(false);
    expect(changeFlags([r("a", { status: "Done", initiative_status: "Completed" })], TODAY).has("a")).toBe(false);
    expect(changeFlags([r("a", { status: "Done", initiative_status: "Cancelled" })], TODAY).has("a")).toBe(false);
    expect(changeFlags([r("a", { status: "In progress", initiative_phase: "Build" })], TODAY).get("a")?.some((x) => x.kind === "no-phase")).not.toBe(true);
  });

  it("keeps the Needs attention reasons too, with their labels", () => {
    const f = changeFlags([r("a", { initiative_phase: "Build", initiative_status: "Active", status: "Done", sponsor: "Dana" })], TODAY).get("a")!; // an owner, so only the Needs attention reason shows
    expect(f).toEqual([expect.objectContaining({ kind: "build-done", label: "Build done" })]);
  });
});


const issue: TrackerRef = { tracker: "Jira", key: "R8P-7049", title: "Bidder adapter, iteration 1", url: "https://example.test/browse/R8P-7049" };
const flag: ChangeFlag = { kind: "tracker-done-open", label: "Tracker done, initiative open", text: "The tracker says the work is done." };
const feed: FeedRow[] = [
  row("a", "items", "initiative_status", "Active", "Completed", "2026-11-17T12:30:00Z", { actor_id: "u2" }),
  row("a", "items", "status", "In progress", "Done", "2026-11-17T12:10:00Z", { actor_id: "u1", via: "UI" }), // a person pressed Sync (not the same step as the Jira row: stays a row of its own)
  row("a", "item_jira_links", "jira_status", "Project Execution", "Project Closed", "2026-11-17T12:18:00Z", { actor_id: null, via: "system" }),
  row("b", "items", "health", "On Track", "At Risk", "2026-11-16T12:00:00Z"),
  row("zzz", "items", "health", "On Track", "Blocked", "2026-11-17T12:00:00Z"), // not an initiative of the filtered rows
  row("b", "items", "health", "On Track", "On Track", "2026-11-16T12:01:00Z"), // no change
];
const rows = (extra: Parameters<typeof buildChangeRows>[2] = {}) => buildChangeRows(feed, items, { nameOf, flags: new Map([["a", [flag]]]), issues: new Map([["a", issue]]), ...extra });

describe("buildChangeRows: where a change came from and who is on it", () => {
  it("keeps only changes of the initiatives shown, newest first, and drops a value that did not change", () => {
    expect(rows().map((r) => [r.code, r.type])).toEqual([["R-27", "initiative-status"], ["R-27", "issue-status"], ["R-27", "build-status"], ["G-03", "health"]]);
  });

  it("Source is Product Velocity for what people set, and the tracker for what the tracker sets", () => {
    const r = Object.fromEntries(rows().map((x) => [x.type, x]));
    expect(r["initiative-status"]!.source).toBe("Product Velocity");
    expect(r["health"]!.source).toBe("Product Velocity");
    expect(r["issue-status"]!.source).toBe("Jira");
    expect(r["build-status"]!.source).toBe("Jira"); // from the tracker of the initiative's link
  });

  it("a GitHub link says GitHub; a Build Status with no known link says GitHub for a webhook and Tracker otherwise", () => {
    const gh = buildChangeRows([row("a", "item_github_links", "gh_state", "open", "closed_completed", "2026-11-17T10:00:00Z", { via: "GitHub webhook", actor_id: null })], items, { nameOf });
    expect(gh[0]).toMatchObject({ source: "GitHub", sourceType: "GitHub webhook", to: "Closed" });
    const unknown = buildChangeRows([row("a", "items", "status", "In progress", "Done", "2026-11-17T10:00:00Z", { via: "GitHub webhook", actor_id: null }), row("a", "items", "status", "Not started", "In progress", "2026-11-17T09:00:00Z")], items, { nameOf });
    expect(unknown.map((x) => x.source)).toEqual(["GitHub", "Tracker"]);
  });

  it("Source type is how it reached Product Velocity", () => {
    expect(rows().map((r) => r.sourceType)).toEqual(["UI", "system", "UI", "UI"]);
  });

  it("a person on a tracker value only ran the Sync: it never reads as their change (review finding)", () => {
    const r = Object.fromEntries(rows().map((x) => [x.type, x]));
    expect(r["build-status"]).toMatchObject({ trackerDriven: true, actor: "Ana", by: "Sync run by Ana" });
    expect(r["issue-status"]).toMatchObject({ trackerDriven: true, actor: "the system", by: "the system" });
    expect(r["initiative-status"]).toMatchObject({ trackerDriven: false, by: "Ben" }); // a person's own change keeps their name
  });

  it("the tracker issue is attached to Build Status and linked-issue changes only, and the flags to every row of the initiative", () => {
    const r = rows();
    expect(r.map((x) => x.issue?.key ?? null)).toEqual([null, "R8P-7049", "R8P-7049", null]);
    expect(r.filter((x) => x.itemId === "a").every((x) => x.flags.length === 1)).toBe(true);
    expect(rows({ issues: new Map(), flags: new Map() }).every((x) => x.issue === null && x.flags.length === 0)).toBe(true);
  });
});

describe("filters and search", () => {
  const all = rows();
  it("quick filters: flagged, initiative moved, tracker changes", () => {
    expect(filterChangeRows(all, { ...NO_CHANGE_FILTERS, quick: ["flagged"] }).every((r) => r.itemId === "a")).toBe(true);
    expect(filterChangeRows(all, { ...NO_CHANGE_FILTERS, quick: ["initiative"] }).map((r) => r.type)).toEqual(["initiative-status", "health"]);
    expect(filterChangeRows(all, { ...NO_CHANGE_FILTERS, quick: ["tracker"] }).map((r) => r.type)).toEqual(["issue-status", "build-status"]);
    expect(filterChangeRows(all, { ...NO_CHANGE_FILTERS, quick: ["flagged", "initiative"] }).map((r) => r.type)).toEqual(["initiative-status"]); // AND
  });
  it("rules match any of their values, and all rules must match", () => {
    expect(filterChangeRows(all, { ...NO_CHANGE_FILTERS, rules: [{ field: "source", values: ["Jira"] }] })).toHaveLength(2);
    expect(filterChangeRows(all, { ...NO_CHANGE_FILTERS, rules: [{ field: "type", values: ["health", "phase"] }] })).toHaveLength(1);
    expect(filterChangeRows(all, { ...NO_CHANGE_FILTERS, rules: [{ field: "source", values: ["Jira"] }, { field: "by", values: ["Ana"] }] }).map((r) => r.type)).toEqual(["build-status"]);
    expect(filterChangeRows(all, { ...NO_CHANGE_FILTERS, rules: [{ field: "flag", values: ["tracker-done-open"] }] })).toHaveLength(3);
    expect(filterChangeRows(all, { ...NO_CHANGE_FILTERS, rules: [{ field: "type", values: [] }] })).toHaveLength(4); // a rule without a value is ignored
  });
  it("search looks at the initiative, the values, the people, the source and the tracker issue, every word must be found", () => {
    expect(all.filter((r) => matchesChangeSearch(r, "bidder")).length).toBe(3);
    expect(all.filter((r) => matchesChangeSearch(r, "r8p-7049")).length).toBe(2);
    expect(all.filter((r) => matchesChangeSearch(r, "closed jira")).length).toBe(1);
    expect(all.filter((r) => matchesChangeSearch(r, "ben")).length).toBe(1);
    expect(all.filter((r) => matchesChangeSearch(r, "nothing like this")).length).toBe(0);
    expect(all.every((r) => matchesChangeSearch(r, "  "))).toBe(true);
  });
  it("counts the active filters and lists the values a rule can take in the data", () => {
    expect(changeFilterCount({ quick: ["flagged"], rules: [{ field: "type", values: ["health"] }, { field: "by", values: [] }], search: "x" })).toBe(2);
    expect(changeFieldChoices(all, "type").map((c) => c.label)).toEqual(["Status", "Health", "Build status", "Linked issue"]);
    expect(changeFieldChoices(all, "source").map((c) => c.value)).toEqual(["Product Velocity", "Jira"]);
    expect(changeFieldChoices(all, "flag")).toEqual([{ value: "tracker-done-open", label: "Tracker done, initiative open" }]);
  });
});

describe("groupChangeRows", () => {
  const all = rows();
  const kinds = (g: ReturnType<typeof groupChangeRows>) => g.map((r) => (isChangeHeader(r) ? `H${r.level}:${r.label}` : r.type));

  it("by initiative: a header before each, newest group first, saying whether the initiative moved and the flags", () => {
    const g = groupChangeRows(all, "initiative", null, new Set());
    expect(kinds(g)).toEqual(["H0:R-27 Bidder adapter", "initiative-status", "issue-status", "build-status", "H0:G-03 Manager onboarding", "health"]);
    const h = g[0]!;
    expect(isChangeHeader(h) && h).toMatchObject({ __group: true, key: "initiative:a", count: 3, unit: "changes", level: 0 });
    expect((h as { badges: { text: string; tone: string }[] }).badges.map((b) => b.text)).toEqual(["Initiative: Status", "2 linked-issue changes", "⚑ Tracker done, initiative open"]);
    const h2 = g[4] as { badges: { text: string }[] };
    expect(h2.badges.map((b) => b.text)).toEqual(["Initiative: Health"]);
  });

  it("an initiative with only linked-issue changes is marked unchanged", () => {
    const only = all.filter((r) => r.type === "issue-status");
    const h = groupChangeRows(only, "initiative", null, new Set())[0] as { badges: { text: string }[] };
    expect(h.badges[0]!.text).toBe("Initiative unchanged");
  });

  it("collapsing a group shows only its header, with the same key the Roadmap grid uses", () => {
    const g = groupChangeRows(all, "initiative", null, new Set(["initiative:a"]));
    expect(kinds(g)).toEqual(["H0:R-27 Bidder adapter", "H0:G-03 Manager onboarding", "health"]);
    expect((g[0] as { collapsed: boolean }).collapsed).toBe(true);
  });

  it("by change type in the order of the list, by source in its order, by source type A to Z, by day newest first", () => {
    expect(kinds(groupChangeRows(all, "type", null, new Set())).filter((x) => x.startsWith("H"))).toEqual(["H0:Status", "H0:Health", "H0:Build status", "H0:Linked issue"]);
    expect(kinds(groupChangeRows(all, "source", null, new Set())).filter((x) => x.startsWith("H"))).toEqual(["H0:Product Velocity", "H0:Jira"]);
    expect(kinds(groupChangeRows(all, "sourceType", null, new Set())).filter((x) => x.startsWith("H"))).toEqual(["H0:system", "H0:UI"]);
    expect(kinds(groupChangeRows(all, "day", null, new Set())).filter((x) => x.startsWith("H")).length).toBe(2);
  });

  it("two levels: a header inside each group, collapsing the parent hides the sub-headers", () => {
    const g = groupChangeRows(all, "source", "type", new Set());
    expect(kinds(g)).toEqual(["H0:Product Velocity", "H1:Status", "initiative-status", "H1:Health", "health", "H0:Jira", "H1:Build status", "build-status", "H1:Linked issue", "issue-status"]);
    expect((g[1] as { key: string }).key).toBe("source:Product Velocity>type:initiative-status");
    expect(kinds(groupChangeRows(all, "source", "type", new Set(["source:Jira"])))).toEqual(["H0:Product Velocity", "H1:Status", "initiative-status", "H1:Health", "health", "H0:Jira"]);
  });

  it("a second level equal to the first is ignored, a missing first level promotes the second, and no grouping is a flat list, newest first", () => {
    expect(kinds(groupChangeRows(all, "type", "type", new Set())).filter((x) => x.startsWith("H1"))).toEqual([]);
    expect(kinds(groupChangeRows(all, null, "type", new Set()))[0]).toBe("H0:Status");
    const flat = groupChangeRows(all, null, null, new Set());
    expect(flat.some(isChangeHeader)).toBe(false);
    expect((flat as ChangeRowData[]).map((r) => r.at)).toEqual([...(flat as ChangeRowData[])].map((r) => r.at).sort().reverse());
  });

  it("never groups by person (rule 8), and says the grouping in words", () => {
    expect(changeGroupSummary("initiative", "type")).toBe("Initiative › Change type");
    expect(changeGroupSummary(null, null)).toBe("None");
    expect(changeGroupSummary("type", "type")).toBe("Change type");
  });
});


describe("one row for a tracker move (issue #472: R-72 had eight rows for four Jira moves)", () => {
  const move = (at: string, from: string, to: string, bFrom: string, bTo: string, extra: Partial<FeedRow> = {}) => [
    row("a", "items", "status", bFrom, bTo, at, { actor_id: null, via: "system", ...extra }),
    row("a", "item_jira_links", "jira_status", from, to, at, { actor_id: null, via: "system", ...extra }),
  ];
  const r72 = [
    ...move("2026-11-17T16:31:00Z", "Project Execution", "Project Closed", "In progress", "Done"),
    ...move("2026-11-17T16:30:47Z", "Project Accepted", "Project Execution", "Not started", "In progress"),
    ...move("2026-11-17T09:18:24Z", "Project Execution", "Project Accepted", "In progress", "Not started"),
    ...move("2026-11-17T09:18:11Z", "Project Closed", "Project Execution", "Done", "In progress"),
  ];

  it("eight rows become four: the linked-issue status carries the Build Status that went with it", () => {
    const rows = buildChangeRows(r72, items, { issues: new Map([["a", issue]]) });
    expect(rows).toHaveLength(4);
    expect(rows.every((x) => x.type === "issue-status")).toBe(true);
    expect(rows[0]).toMatchObject({ from: "Project Execution", to: "Project Closed", alsoBuild: { from: "In progress", to: "Done", tone: "good" } });
    expect(rows[2]!.alsoBuild).toMatchObject({ from: "In progress", to: "Not started" });
  });

  it("a Jira status takes the colour of its category, learned from the Build Status that moved with it, on both sides of the arrow (#480)", () => {
    const rows = buildChangeRows(r72, items, { issues: new Map([["a", issue]]) });
    expect(rows[0]).toMatchObject({ to: "Project Closed", tone: "good", from: "Project Execution", fromTone: "info" });
    expect(rows[1]).toMatchObject({ to: "Project Execution", tone: "info", fromTone: "neutral" }); // Project Accepted: Not started
    expect(rows[2]).toMatchObject({ to: "Project Accepted", tone: "neutral", fromTone: "info" });
    // what Jira itself says about the status now wins over what was learned
    const told = buildChangeRows(r72, items, { issues: new Map([["a", issue]]), jiraCategories: new Map([["Project Accepted", "indeterminate" as const]]) });
    expect(told[2]).toMatchObject({ to: "Project Accepted", tone: "info" });
    expect(jiraCategoryTone("done")).toBe("good");
    expect(jiraCategoryTone(null)).toBe("neutral");
  });

  it("a Build Status change in another step, or with no linked-issue change, stays a row of its own", () => {
    const rows = buildChangeRows([row("a", "items", "status", "In progress", "Done", "2026-11-17T10:00:00Z"), row("a", "item_jira_links", "jira_status", "To Do", "Done", "2026-11-17T10:00:09Z")], items);
    expect(rows.map((x) => [x.type, x.alsoBuild])).toEqual([["issue-status", null], ["build-status", null]]);
  });

  it("a merged row still answers to the Build status filter and to a search for its Build Status values", () => {
    const rows = buildChangeRows(r72, items, { issues: new Map([["a", issue]]) });
    expect(filterChangeRows(rows, { ...NO_CHANGE_FILTERS, rules: [{ field: "type", values: ["build-status"] }] })).toHaveLength(4);
    expect(rows.filter((x) => matchesChangeSearch(x, "not started"))).toHaveLength(2);
    expect(changeFieldChoices(rows, "type").map((c) => c.value)).toEqual(["build-status", "issue-status"].sort((a, b) => ["phase", "initiative-status", "health", "build-status", "issue-status"].indexOf(a) - ["phase", "initiative-status", "health", "build-status", "issue-status"].indexOf(b)));
  });

  it("a person who pressed Sync stays on the merged row, as 'Sync run by'", () => {
    const f: FeedRow[] = [row("a", "items", "status", "In progress", "Done", "2026-11-17T10:00:00Z", { actor_id: "u1", via: "UI" }), row("a", "item_jira_links", "jira_status", "Project Execution", "Project Closed", "2026-11-17T10:00:00Z", { actor_id: null, via: "system" })];
    const rows = buildChangeRows(f, items, { nameOf, issues: new Map([["a", issue]]) });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ by: "Sync run by Ana", actorId: "u1" });
  });

  it("GitHub gets the same: the issue state and Build Status of one webhook are one row", () => {
    const rows = buildChangeRows([row("a", "items", "status", "In progress", "Done", "2026-11-17T10:00:00Z", { actor_id: null, via: "GitHub webhook" }), row("a", "item_github_links", "gh_state", "open", "closed_completed", "2026-11-17T10:00:00Z", { actor_id: null, via: "GitHub webhook" })], items);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "GitHub", to: "Closed", alsoBuild: { to: "Done" } });
  });
});

describe("the Jira user of a change", () => {
  const rec = (to: string, at: string, who: string | null) => ({ issue_key: "R8P-7049", to_status: to, changed_at: at, actor_name: who });
  const f = [row("a", "item_jira_links", "jira_status", "Project Execution", "Project Accepted", "2026-11-17T08:18:24.766Z", { actor_id: null, via: "system" })];
  const users = (list: ReturnType<typeof rec>[]) => buildChangeRows(f, items, { issues: new Map([["a", issue]]), jiraUsers: list })[0]!.jiraUser;

  it("is the user who moved the issue to that status, from Jira's time a moment before PV registered it", () => {
    expect(users([rec("Project Accepted", "2026-11-17T08:18:23.641Z", "Dana Reyes")])).toBe("Dana Reyes");
  });
  it("takes the latest move to that status that Jira made before the registration, not an earlier one and not a later one", () => {
    expect(users([rec("Project Accepted", "2026-11-13T09:00:00Z", "Sam Okoye"), rec("Project Accepted", "2026-11-17T08:18:23.641Z", "Dana Reyes"), rec("Project Accepted", "2026-11-17T09:00:00Z", "Later Person")])).toBe("Dana Reyes");
  });
  it("is empty when Jira named nobody, the status differs, the issue differs, or nothing is known yet", () => {
    expect(users([rec("Project Accepted", "2026-11-17T08:18:23.641Z", null)])).toBeNull();
    expect(users([rec("Project Closed", "2026-11-17T08:18:23.641Z", "Dana Reyes")])).toBeNull();
    expect(users([{ ...rec("Project Accepted", "2026-11-17T08:18:23.641Z", "Dana Reyes"), issue_key: "OTHER-1" }])).toBeNull();
    expect(users([])).toBeNull();
  });
  it("is only for Jira rows, and is found by search", () => {
    const gh = buildChangeRows([row("a", "items", "health", "On Track", "At Risk", "2026-11-17T08:18:24Z")], items, { issues: new Map([["a", issue]]), jiraUsers: [rec("At Risk", "2026-11-17T08:18:23Z", "Dana Reyes")] });
    expect(gh[0]!.jiraUser).toBeNull();
    expect(matchesChangeSearch(buildChangeRows(f, items, { issues: new Map([["a", issue]]), jiraUsers: [rec("Project Accepted", "2026-11-17T08:18:23.641Z", "Dana Reyes")] })[0]!, "dana")).toBe(true);
  });
});

import { actionsOfFlags, flagsOfRow, gateForTarget, openGateOf, primaryRowIds, resolveFlagAction, rowFlagTexts } from "./change-report";

describe("an action on a flag (Ashu 2026-11-17: connect an action like Move phase to Test)", () => {
  const TODAY = new Date(Date.UTC(2026, 10, 17));
  const r = (id: string, o: Record<string, unknown> = {}) => ({ id, item_code: id, initiative_name: id, stack_rank: 1, initiative_status: null, initiative_phase: null, health: "On Track", ...o });

  it("Build done carries the one-click Move to Test of Needs attention; the two report flags suggest Test and Build", () => {
    expect(changeFlags([r("a", { initiative_phase: "Build", initiative_status: "Active", status: "Done" })], TODAY).get("a")![0]!.action).toEqual({ type: "move", to: "Test", label: "Move to Test" });
    expect(changeFlags([r("b", { status: "Done" })], TODAY).get("b")![0]!.action).toEqual({ type: "move", to: "Test", label: "Move to Test" });
    expect(changeFlags([r("c", { status: "In progress" })], TODAY).get("c")![0]!.action).toEqual({ type: "move", to: "Build", label: "Move to Build" });
    expect(changeFlags([r("d", { initiative_phase: "Test", initiative_status: "Active", status: "Not started" })], TODAY).get("d")![0]!.action).toBeUndefined(); // no obvious next step: no button
  });

  it("from Build to Test is a move (no decision gate between them), made at once", () => {
    expect(resolveFlagAction({ type: "move", to: "Test", label: "Move to Test" }, "Build")).toMatchObject({ kind: "move", to: "Test", label: "Move to Test" });
  });

  it("from no phase (counts as Discover) to Test or Build passes a gate, so the button opens the request for the gate that opens that phase", () => {
    const test = resolveFlagAction({ type: "move", to: "Test", label: "Move to Test" }, null);
    expect(test).toMatchObject({ kind: "gate", gate: "B", label: "Request gate B (to Test)" });
    expect(test.title).toMatch(/passes Gate A and later/);
    expect(resolveFlagAction({ type: "move", to: "Build", label: "Move to Build" }, null)).toMatchObject({ kind: "gate", gate: "B", label: "Request gate B (to Build)" });
    expect(resolveFlagAction({ type: "move", to: "Build", label: "Move to Build" }, "Discover")).toMatchObject({ kind: "gate" });
  });

  it("once the gate is requested the button becomes a link to the Decisions page, and a move that needs no gate is unchanged", () => {
    const a = resolveFlagAction({ type: "move", to: "Build", label: "Move to Build" }, null, "B");
    expect(a).toEqual(expect.objectContaining({ kind: "requested", gate: "B", label: "Gate B requested", href: "/decisions" }));
    expect(resolveFlagAction({ type: "move", to: "Test", label: "Move to Test" }, "Build", "B")).toMatchObject({ kind: "move" });
  });

  it("a request is open only while the row is In review or Waiting for Approver", () => {
    expect(openGateOf({ current_gate: "B", gate_status: "In review" })).toBe("B");
    expect(openGateOf({ current_gate: "A", gate_status: "Waiting for Approver" })).toBe("A");
    for (const s of ["Not started", "Held", "Stopped", null, undefined]) expect(openGateOf({ current_gate: "B", gate_status: s })).toBeNull();
    expect(openGateOf({ current_gate: null, gate_status: "In review" })).toBeNull();
    expect(openGateOf(null)).toBeNull();
  });

  it("the gate that opens a phase", () => {
    expect([gateForTarget("Define"), gateForTarget("Build"), gateForTarget("Test"), gateForTarget("Roll-out"), gateForTarget("Discover")]).toEqual(["A", "B", "B", "C", null]);
  });

  it("the buttons sit on the newest row of each initiative, once", () => {
    const f: FeedRow[] = [row("a", "items", "health", "On Track", "At Risk", "2026-11-17T10:00:00Z"), row("a", "items", "health", "At Risk", "Blocked", "2026-11-17T11:00:00Z"), row("b", "items", "health", "On Track", "At Risk", "2026-11-17T09:00:00Z")];
    const rows = buildChangeRows(f, items);
    const ids = primaryRowIds(rows);
    expect(rows.filter((x) => ids.has(x.id)).map((x) => [x.itemId, x.to])).toEqual([["a", "Blocked"], ["b", "At Risk"]]);
  });
});

describe("the Flags and Actions columns of the main grid (#480)", () => {
  const today = new Date("2026-11-17T09:00:00Z");
  const row = { id: "r1", item_code: "R-1", initiative_name: "Tracker done", stack_rank: 1, initiative_phase: null, initiative_status: null, status: "Done", issues_total: 3, issues_closed: 3 };

  it("flagsOfRow gives the flags of the Changes report for one row", () => {
    expect(flagsOfRow(row, today).map((f) => f.kind)).toContain("tracker-done-open");
    expect(flagsOfRow({ ...row, id: "r2", status: "Not started", issues_total: 0, issues_closed: 0 }, today)).toEqual([]);
  });

  it("actions follow the flags, once per button, and a gate request replaces a move that would pass a gate", () => {
    const flags = flagsOfRow(row, today);
    const a = actionsOfFlags(flags, null, true);
    expect(a.map((x) => x.resolved.kind)).toEqual(["gate"]); // no phase counts as Discover: Test passes Gates A and B
    const dup = actionsOfFlags([...flags, ...flags], null, true);
    expect(dup).toHaveLength(a.length);
    const build = actionsOfFlags(flagsOfRow({ ...row, initiative_phase: "Build" }, today), "Build", true);
    expect(build.every((x) => x.resolved.label.length > 0)).toBe(true);
  });

  it("a requested gate shows as a link in the Actions column and in its exported words", () => {
    const asked = { ...row, current_gate: "B", gate_status: "In review" };
    expect(actionsOfFlags(flagsOfRow(asked, today), null, true, openGateOf(asked)).map((x) => x.resolved.kind)).toEqual(["requested", "decisions"]); // the gate link, and the checklist (In review) link to Decisions
    expect(rowFlagTexts(asked, today, true).actions).toBe("Gate B requested; Open Decisions");
  });

  it("a person who cannot edit sees the flags and no actions", () => {
    expect(actionsOfFlags(flagsOfRow(row, today), null, false)).toEqual([]);
    expect(rowFlagTexts(row, today, false)).toMatchObject({ actions: null });
    expect(rowFlagTexts(row, today, false).flags).toContain("Tracker done");
  });

  it("rowFlagTexts gives the words for sorting and export, or null when nothing applies", () => {
    expect(rowFlagTexts(row, today, true).actions).toMatch(/Request gate/);
    expect(rowFlagTexts({ ...row, status: "Not started", issues_total: 0, issues_closed: 0 }, today, true)).toEqual({ flags: null, actions: null });
  });
});

describe("five more flags with a next step (2026-11-19)", () => {
  const TODAY = new Date(Date.UTC(2026, 10, 19));
  const base = { item_code: "R-1", initiative_name: "x", stack_rank: 1, initiative_status: "Active", health: "On Track", sponsor: "Dana", kr_metric: "Activation" };
  const kinds = (o: Record<string, unknown>) => (changeFlags([{ id: "a", ...base, ...o }], TODAY).get("a") ?? []).map((f) => f.kind);

  it("Ready for Gate C: in Experiment long enough with no request, and the button requests Gate C", () => {
    const row = { initiative_phase: "Experiment", phase_changed_at: "2026-11-01T00:00:00Z" };
    expect(kinds(row)).toContain("ready-gate-c");
    expect(changeFlags([{ id: "a", ...base, ...row }], TODAY).get("a")!.find((f) => f.kind === "ready-gate-c")!.action).toEqual({ type: "gate", gate: "C", label: "Request gate C" });
    expect(kinds({ ...row, phase_changed_at: "2026-11-15T00:00:00Z" })).not.toContain("ready-gate-c"); // only 4 days
    expect(kinds({ ...row, current_gate: "C", gate_status: "Waiting for Approver" })).not.toContain("ready-gate-c"); // already asked
  });

  it("a requested Gate C turns the action into the link to Decisions", () => {
    expect(resolveFlagAction({ type: "gate", gate: "C", label: "Request gate C" }, "Experiment", null)).toMatchObject({ kind: "gate", gate: "C" });
    expect(resolveFlagAction({ type: "gate", gate: "C", label: "Request gate C" }, "Experiment", "C")).toMatchObject({ kind: "requested", href: "/decisions" });
  });

  it("Gate checklist incomplete follows Gate Status In review and opens Decisions", () => {
    expect(kinds({ initiative_phase: "Define", current_gate: "B", gate_status: "In review" })).toContain("gate-checklist");
    expect(kinds({ initiative_phase: "Define", current_gate: "B", gate_status: "Waiting for Approver" })).not.toContain("gate-checklist");
    expect(resolveFlagAction({ type: "decisions", label: "Open Decisions" }, "Define")).toMatchObject({ kind: "decisions", href: "/decisions" });
  });

  it("Hold review soon: within a week, not on or after the day (Needs attention takes over then)", () => {
    const held = { initiative_phase: "Build", gate_status: "Held" };
    expect(kinds({ ...held, next_gate_due: "2026-11-23" })).toContain("hold-soon");
    expect(kinds({ ...held, next_gate_due: "2026-11-19" })).not.toContain("hold-soon");
    expect(kinds({ ...held, next_gate_due: "2026-12-30" })).not.toContain("hold-soon");
  });

  it("No Business Owner: Active and past Define only; and the action opens the initiative", () => {
    expect(kinds({ initiative_phase: "Build", sponsor: null })).toContain("no-owner");
    expect(kinds({ initiative_phase: "Define", sponsor: null })).not.toContain("no-owner");
    expect(kinds({ initiative_phase: "Build", sponsor: "Dana" })).not.toContain("no-owner");
    expect(kinds({ initiative_phase: "Completed", sponsor: null })).not.toContain("no-owner");
    expect(resolveFlagAction({ type: "open", label: "Assign owner" }, "Build")).toMatchObject({ kind: "open", label: "Assign owner" });
  });

  it("No key result: in Define with no Primary KR", () => {
    expect(kinds({ initiative_phase: "Define", kr_metric: null })).toContain("no-kr");
    expect(kinds({ initiative_phase: "Define", kr_metric: "Activation" })).not.toContain("no-kr");
    expect(kinds({ initiative_phase: "Build", kr_metric: null })).not.toContain("no-kr");
  });

  it("nothing is flagged for a finished or cancelled initiative", () => {
    expect(kinds({ initiative_phase: "Build", sponsor: null, initiative_status: "Cancelled" })).toEqual([]);
  });
});
