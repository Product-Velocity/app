import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LEADERSHIP_COLUMNS, categoryMix, changesThisWeek, draftWeeklyUpdate, healthByProject, needsAttention, topItems, weekWindow, type AuditChange,
} from "./leadership";

const projects = [{ id: "p1", name: "Platform" }, { id: "p2", name: "Marketplace" }];
const row = (id: string, rank: number, extra: Record<string, unknown> = {}) => ({ id, item_code: `R-${String(rank).padStart(2, "0")}`, initiative_name: `Item ${rank}`, stack_rank: rank, home_project: "p1", ...extra });
const TODAY = new Date(Date.UTC(2026, 9, 23)); // Fri 23 Oct 2026, ISO week 43

describe("the Leadership column list is the one in docs/reference/default-views.csv", () => {
  it("has the same keys in the same order, the first three pinned", () => {
    const csv = readFileSync(new URL("../../../docs/reference/default-views.csv", import.meta.url), "utf8").trim().split(/\r?\n/).slice(1).map((l) => l.split(",")).filter((c) => c[0] === "Leadership");
    expect(LEADERSHIP_COLUMNS.map((c) => c.key)).toEqual(csv.map((c) => c[2]));
    expect(LEADERSHIP_COLUMNS.filter((c) => c.pinned).map((c) => c.key)).toEqual(csv.filter((c) => c[3] === "pinned").map((c) => c[2]));
  });
});

describe("weekWindow", () => {
  it("is the ISO week (Monday to Sunday) of a day, with its number and a label", () => {
    const w = weekWindow(TODAY);
    expect(w).toMatchObject({ start: "2026-10-19", end: "2026-10-26", number: 43 });
    expect(w.label).toBe("Week 43 · 19 to 25 Oct 2026");
    expect(weekWindow(new Date(Date.UTC(2026, 9, 19))).start).toBe("2026-10-19"); // Monday
    expect(weekWindow(new Date(Date.UTC(2026, 9, 25))).start).toBe("2026-10-19"); // Sunday
    expect(weekWindow(new Date(Date.UTC(2027, 0, 1))).number).toBe(53); // 1 Jan 2027 is in 2026's week 53
    expect(weekWindow(new Date(Date.UTC(2026, 11, 28))).label).toBe("Week 53 · 28 Dec 2026 to 3 Jan 2027");
  });
});

describe("healthByProject", () => {
  const rows = [
    row("a", 1, { health: "On Track" }), row("b", 2, { health: "At Risk" }), row("c", 3, { health: "Delayed", home_project: "p2" }),
    row("d", 4, { health: null, home_project: "p2" }), row("e", 5, { health: "Blocked", home_project: "p2" }),
  ];
  it("counts every health state per project with words, projects A to Z, and totals", () => {
    const h = healthByProject(rows, projects);
    expect(h.projects.map((p) => p.name)).toEqual(["Marketplace", "Platform"]);
    expect(h.projects[0]).toMatchObject({ total: 3, counts: { "On Track": 0, "At Risk": 0, "Delayed": 1, "Blocked": 1, "No health": 1 } });
    expect(h.projects[1]).toMatchObject({ total: 2, counts: { "On Track": 1, "At Risk": 1, "Delayed": 0, "Blocked": 0, "No health": 0 } });
    expect(h.totals).toMatchObject({ total: 5, counts: { "On Track": 1, "At Risk": 1, "Delayed": 1, "Blocked": 1, "No health": 1 } });
  });
  it("leaves out projects that have no initiatives in the scope", () => {
    expect(healthByProject([row("a", 1, { health: "On Track" })], projects).projects.map((p) => p.name)).toEqual(["Platform"]);
  });
  it("says in words how a project is doing: the worst state present", () => {
    const h = healthByProject(rows, projects);
    expect(h.projects[0]!.summary).toBe("1 Blocked, 1 Delayed, 1 No health");
    expect(h.projects[1]!.summary).toBe("1 At Risk, 1 On Track");
  });
});

describe("topItems", () => {
  it("is the first n by global rank, whatever the order they come in", () => {
    const rows = [row("c", 3), row("a", 1), row("b", 2), row("d", 4)];
    expect(topItems(rows, 2).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("needsAttention", () => {
  it("lists Blocked, Delayed and At Risk initiatives, and ones past their G2M date, with the reasons in words", () => {
    const rows = [
      row("a", 1, { health: "On Track", g2m_date_est: "2026-12-01" }),
      row("b", 2, { health: "At Risk" }),
      row("c", 3, { health: "Delayed", g2m_date_est: "2026-09-30" }),
      row("d", 4, { health: "Blocked" }),
      row("e", 5, { health: "On Track", g2m_date_est: "2026-10-01" }),
      row("f", 6, { health: "On Track", g2m_date_est: "2026-10-01", status: "Completed" }),
      row("g", 7, { health: "At Risk", initiative_phase: "Completed" }),
    ];
    const n = needsAttention(rows, TODAY);
    expect(n.map((x) => x.id)).toEqual(["d", "c", "b", "e", "g"]); // worst first, then by rank
    expect(n.find((x) => x.id === "c")!.reasons).toEqual(["Health is Delayed", "G2M Date (est) 30 Sep has passed"]);
    expect(n.find((x) => x.id === "e")!.reasons).toEqual(["G2M Date (est) 1 Oct has passed"]);
    expect(n.find((x) => x.id === "d")!.health).toBe("Blocked");
  });
  it("a finished initiative is not late; blocked GitHub issues count once they exist", () => {
    expect(needsAttention([row("f", 1, { g2m_date_est: "2026-01-01", status: "Cancelled" }), row("g", 2, { g2m_date_est: "2026-01-01", initiative_phase: "Sunset" })], TODAY)).toEqual([]);
    expect(needsAttention([row("h", 1, { health: "On Track", blocked_issues: 2 })], TODAY)[0]!.reasons).toEqual(["2 blocked issues on GitHub"]);
  });
});

describe("categoryMix", () => {
  it("counts the Roadmap Categories in the dictionary's order with whole-number shares, and 'No category'", () => {
    const rows = [row("a", 1, { roadmap_category: "Grow customer revenues" }), row("b", 2, { roadmap_category: "Grow customer revenues" }), row("c", 3, { roadmap_category: "New big bets" }), row("d", 4)];
    const m = categoryMix(rows);
    expect(m.map((x) => [x.label, x.count, x.pct])).toEqual([
      ["New big bets", 1, 25], ["Grow customer revenues", 2, 50], ["Protect customer revenues", 0, 0], ["Operational efficiency", 0, 0], ["Close capability gaps", 0, 0], ["No category", 1, 25],
    ]);
  });
  it("is empty of shares when there are no initiatives", () => {
    expect(categoryMix([]).every((x) => x.pct === 0 && x.count === 0)).toBe(true);
  });
});

describe("changesThisWeek: what moved, from the audit log", () => {
  const rows = [row("a", 5), row("b", 2), row("c", 7)];
  const ch = (o: Partial<AuditChange>): AuditChange => ({ itemId: "a", field: "stack_rank", old: 8, new: 5, at: "2026-10-20T09:00:00Z", actorId: "u1", via: "UI", ...o });
  it("a rank change is the net move over the week, up is better", () => {
    const m = changesThisWeek([ch({ old: 8, new: 6, at: "2026-10-20T09:00:00Z" }), ch({ old: 6, new: 5, at: "2026-10-21T09:00:00Z" })], rows);
    expect(m).toEqual([{ itemId: "a", kind: "rank", text: "R-05 Item 5 moved up 3 places (#8 to #5)", at: "2026-10-21T09:00:00Z" }]);
  });
  it("a rank that ended where it started is not a change; down is worded as down", () => {
    expect(changesThisWeek([ch({ old: 5, new: 9, at: "2026-10-20T09:00:00Z" }), ch({ old: 9, new: 5, at: "2026-10-21T09:00:00Z" })], rows)).toEqual([]);
    expect(changesThisWeek([ch({ itemId: "b", old: 2, new: 4 })], rows)[0]!.text).toBe("R-02 Item 2 moved down 2 places (#2 to #4)");
    expect(changesThisWeek([ch({ itemId: "b", old: 2, new: 3 })], rows)[0]!.text).toContain("1 place ");
  });
  it("status and health changes are listed in words, oldest first inside an item, newest item first", () => {
    const m = changesThisWeek([
      ch({ itemId: "b", field: "status", old: "Backlog", new: "In Progress", at: "2026-10-20T10:00:00Z" }),
      ch({ itemId: "c", field: "health", old: "On Track", new: "At Risk", at: "2026-10-22T10:00:00Z" }),
    ], rows);
    expect(m.map((x) => x.text)).toEqual(["R-07 Item 7 health changed from On Track to At Risk", "R-02 Item 2 status changed from Backlog to In Progress"]);
    expect(changesThisWeek([ch({ itemId: "b", field: "health", old: null, new: "On Track" })], rows)[0]!.text).toBe("R-02 Item 2 health set to On Track");
  });
  it("ignores items that are not in the scope", () => {
    expect(changesThisWeek([ch({ itemId: "zzz" })], rows)).toEqual([]);
  });
});

describe("draftWeeklyUpdate", () => {
  const rows = [
    row("a", 1, { health: "On Track", g2m_date_est: "2026-10-30", initiative_phase: "Roll-out" }),
    row("b", 2, { health: "Blocked", g2m_date_est: "2026-12-11" }),
    row("c", 3, { health: "At Risk", g2m_date_est: "2026-10-01" }),
    row("d", 4, { health: "On Track", status: "Completed", g2m_date_actual: "2026-10-21" }),
    row("e", 5, { health: "On Track", g2m_date_est: "2027-02-01" }),
  ];
  const changes = changesThisWeek([{ itemId: "e", field: "stack_rank", old: 9, new: 5, at: "2026-10-21T09:00:00Z", actorId: "u1", via: "UI" }], rows);
  const draft = draftWeeklyUpdate({ rows, projects, scopeLabel: "All projects", today: TODAY, changes });
  it("has a heading, highlights, risks and asks, what moved, the next two weeks and the investment mix", () => {
    expect(draft.text.split("\n")[0]).toBe("All projects, week 43 (19 to 25 Oct 2026)");
    for (const h of ["Highlights", "Risks and asks", "What moved this week", "Next two weeks", "Investment mix"]) expect(draft.text).toContain(`\n${h}\n`);
  });
  it("every statement names its initiative, with the facts from the data", () => {
    expect(draft.text).toContain("R-04 Item 4 was completed on 21 Oct.");
    expect(draft.text).toContain("R-01 Item 1 is in roll-out. G2M is 30 Oct.");
    expect(draft.text).toContain("R-02 Item 2 is blocked.");
    expect(draft.text).toContain("R-03 Item 3 is at risk. G2M Date (est) 1 Oct has passed.");
    expect(draft.text).toContain("R-05 Item 5 moved up 4 places (#9 to #5)");
    expect(draft.text).toContain("R-01 goes live 30 Oct.");
    expect(draft.text).toMatch(/1 in New big bets|No category: 5/);
  });
  it("leaves a line for the ask, and says nothing is sent", () => {
    expect(draft.text).toContain("Ask: ");
    expect(draft.text).not.toContain("undefined");
    expect(draft.text).not.toContain("NaN");
  });
  it("lists the initiatives it is based on, for links", () => {
    expect(draft.sources.sort()).toEqual(["a", "b", "c", "d", "e"].sort());
  });
  it("is calm when nothing happened", () => {
    const quiet = draftWeeklyUpdate({ rows: [row("x", 1, { health: "On Track" })], projects, scopeLabel: "Platform", today: TODAY, changes: [] });
    expect(quiet.text).toContain("Nothing completed this week.");
    expect(quiet.text).toContain("Nothing needs attention.");
    expect(quiet.text).toContain("No rank, status or health changes this week.");
    expect(quiet.text).toContain("Nothing is due in the next two weeks.");
  });
});
