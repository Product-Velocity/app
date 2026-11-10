import { describe, expect, it } from "vitest";
import { NO_FILTERS, NO_QUARTER, filterRows, needCounts, needsYou, participation, plannedQuarters, quarterOptions, quarterText, sortRows, summarize, type SessionRow, type SessionStats } from "./alignment-list";

const NOW = new Date("2027-03-10T12:00:00Z");
let n = 0;
const row = (over: Omit<Partial<SessionRow>, "stats"> & { stats?: Partial<SessionStats> | null } = {}): SessionRow => {
  const { stats, ...rest } = over;
  n++;
  return {
    id: `s${n}`, name: `Session ${n}`, method: "coins", status: "closed", createdAt: `2027-01-${String(10 + n).padStart(2, "0")}T09:00:00Z`, openedAt: "2027-01-20T09:00:00Z",
    closesAt: "2027-02-10T17:00:00Z", closedAt: "2027-02-10T17:00:00Z", createdBy: "u1", initiatives: 8, itemNames: "Self-serve onboarding, Payout reconciliation", quarter: "Q1 2027", quarters: ["Q1 2027"], contested: 2,
    stats: stats === null ? null : { invited: 10, voted: 7, mailingDraft: false, applied: null, undone: false, ...stats },
    ...rest,
  };
};

describe("the planned quarter of a session", () => {
  it("is the Planned Quarter most of its initiatives have, and lists every quarter that occurs, oldest first", () => {
    expect(plannedQuarters(["Q1 2027", "Q1 2027", "Q2 2027"])).toEqual({ quarter: "Q1 2027", quarters: ["Q1 2027", "Q2 2027"] });
    expect(plannedQuarters(["Q2 2027", "Q1 2027", "Q2 2027"])).toEqual({ quarter: "Q2 2027", quarters: ["Q1 2027", "Q2 2027"] });
    expect(plannedQuarters(["Q4 2026", "Q1 2027"])).toEqual({ quarter: "Q4 2026", quarters: ["Q4 2026", "Q1 2027"] }); // a tie: the earlier one
  });
  it("sorts quarters by year, not as text, and ignores initiatives without one", () => {
    expect(plannedQuarters(["Q1 2028", null, "Q4 2026", undefined, "Q4 2026"]).quarters).toEqual(["Q4 2026", "Q1 2028"]);
  });
  it("is none when no initiative has one", () => {
    expect(plannedQuarters([null, undefined])).toEqual({ quarter: null, quarters: [] });
    expect(plannedQuarters([])).toEqual({ quarter: null, quarters: [] });
    expect(quarterText({ quarter: null })).toBe(NO_QUARTER);
  });
  it("does not depend on when the session closed", () => {
    expect(quarterText(row({ closedAt: "2030-01-01T00:00:00Z", quarter: "Q1 2027" }))).toBe("Q1 2027");
  });
});

describe("what needs an admin", () => {
  it("finds a draft with nobody invited, a mailing waiting for a confirm, a session closing within 48 hours and a closed one not applied", () => {
    expect(needsYou(row({ status: "draft", stats: { invited: 0 } }), NOW)).toEqual(["no-participants"]);
    expect(needsYou(row({ status: "open", closesAt: "2027-03-11T12:00:00Z", closedAt: null, stats: { mailingDraft: true } }), NOW).sort()).toEqual(["closing-soon", "confirm-mailing"]);
    expect(needsYou(row({ status: "closed", stats: { voted: 5 } }), NOW)).toEqual(["not-applied"]);
  });
  it("does not flag what is fine: far-off closing, already closed time, applied, undone, nobody voted, an archived session", () => {
    expect(needsYou(row({ status: "open", closesAt: "2027-03-20T12:00:00Z", closedAt: null }), NOW)).toEqual([]);
    expect(needsYou(row({ status: "open", closesAt: "2027-03-09T12:00:00Z", closedAt: null }), NOW)).toEqual([]);
    expect(needsYou(row({ stats: { applied: { at: "2027-02-12T10:00:00Z", moved: 3 } } }), NOW)).toEqual([]);
    expect(needsYou(row({ stats: { undone: true } }), NOW)).toEqual([]);
    expect(needsYou(row({ stats: { voted: 0 } }), NOW)).toEqual([]);
    expect(needsYou(row({ status: "draft", stats: { invited: 4 } }), NOW)).toEqual([]);
  });
  it("is empty for someone without the admin-only values", () => {
    expect(needsYou(row({ status: "draft", stats: null }), NOW)).toEqual([]);
  });
  it("counts each need over the rows", () => {
    const rows = [row({ status: "draft", stats: { invited: 0 } }), row({ stats: { voted: 4 } }), row({ stats: { voted: 4 } })];
    expect(needCounts(rows, NOW)).toEqual({ "no-participants": 1, "confirm-mailing": 0, "closing-soon": 0, "not-applied": 2 });
  });
});

describe("searching and filtering", () => {
  const a = row({ name: "Q1 priorities", itemNames: "Self-serve onboarding, Bidder dashboard", method: "coins" });
  const b = row({ name: "Roadmap vote", itemNames: "Payout reconciliation", method: "ice", status: "open", closedAt: null, closesAt: "2027-05-01T00:00:00Z", quarter: "Q2 2027", quarters: ["Q2 2027", "Q3 2027"], stats: { voted: 1 } });
  const c = row({ name: "Old vote", status: "archived", closedAt: "2026-06-01T00:00:00Z", quarter: "Q2 2026", quarters: ["Q2 2026"] });
  const all = [a, b, c];
  it("finds a session by its name and by the name of an initiative in it, every word having to match", () => {
    expect(filterRows(all, { ...NO_FILTERS, q: "priorities" }, NOW)).toEqual([a]);
    expect(filterRows(all, { ...NO_FILTERS, q: "payout" }, NOW)).toEqual([b]);
    expect(filterRows(all, { ...NO_FILTERS, q: "bidder onboarding" }, NOW)).toEqual([a]);
    expect(filterRows(all, { ...NO_FILTERS, q: "bidder payout" }, NOW)).toEqual([]);
  });
  it("hides archived sessions unless asked for, or unless the status filter is archived", () => {
    expect(filterRows(all, NO_FILTERS, NOW)).toEqual([a, b]);
    expect(filterRows(all, { ...NO_FILTERS, showArchived: true }, NOW)).toEqual(all);
    expect(filterRows(all, { ...NO_FILTERS, status: "archived" }, NOW)).toEqual([c]);
  });
  it("combines status, method, quarter, applied and need", () => {
    expect(filterRows(all, { ...NO_FILTERS, status: "open" }, NOW)).toEqual([b]);
    expect(filterRows(all, { ...NO_FILTERS, method: "ice" }, NOW)).toEqual([b]);
    expect(filterRows(all, { ...NO_FILTERS, quarter: "Q1 2027" }, NOW)).toEqual([a]);
    expect(filterRows(all, { ...NO_FILTERS, quarter: "Q3 2027" }, NOW)).toEqual([b]); // any of its initiatives' planned quarters, not only the main one
    expect(filterRows(all, { ...NO_FILTERS, applied: "not-applied" }, NOW)).toEqual([a]);
    expect(filterRows(all, { ...NO_FILTERS, need: "not-applied", status: "closed" }, NOW)).toEqual([a]);
    expect(filterRows(all, { ...NO_FILTERS, q: "vote", method: "coins", showArchived: true }, NOW)).toEqual([c]);
  });
  it("lists the planned quarters present, oldest first, with no planned quarter last", () => {
    const d = row({ status: "draft", closedAt: null, closesAt: null, quarter: null, quarters: [] });
    // a: Q1 2027, b: Q2 2027 and Q3 2027, c: Q2 2026, d: none
    expect(quarterOptions([...all, d])).toEqual(["Q2 2026", "Q1 2027", "Q2 2027", "Q3 2027", NO_QUARTER]);
    expect(filterRows([...all, d], { ...NO_FILTERS, quarter: NO_QUARTER }, NOW)).toEqual([d]);
  });
});

describe("sorting", () => {
  it("sorts by a column in either direction, with empty values last, and the same way every time", () => {
    const a = row({ name: "b", initiatives: 5 });
    const b = row({ name: "a", initiatives: 9 });
    const c = row({ name: "c", initiatives: 5, status: "draft", closedAt: null, closesAt: null });
    expect(sortRows([a, b, c], "name", "asc").map((r) => r.name)).toEqual(["a", "b", "c"]);
    expect(sortRows([a, b, c], "initiatives", "desc").map((r) => r.initiatives)).toEqual([9, 5, 5]);
    expect(sortRows([a, b, c], "closed", "asc").at(-1)).toBe(c);
    expect(sortRows([a, b, c], "closed", "desc").at(-1)).toBe(c);
    expect(sortRows([c, a, b], "initiatives", "desc")).toEqual(sortRows([b, c, a], "initiatives", "desc"));
  });
  it("sorts planned quarters by year then quarter, not as text, with sessions without one last", () => {
    const q = (quarter: string | null) => row({ quarter, quarters: quarter ? [quarter] : [] });
    const rows = [q("Q1 2027"), q(null), q("Q4 2026"), q("Q3 2027")];
    expect(sortRows(rows, "quarter", "asc").map(quarterText)).toEqual(["Q4 2026", "Q1 2027", "Q3 2027", NO_QUARTER]);
    expect(sortRows(rows, "quarter", "desc").map(quarterText)).toEqual(["Q3 2027", "Q1 2027", "Q4 2026", NO_QUARTER]);
  });
  it("puts open sessions before drafts before closed ones when sorted by status", () => {
    const rows = [row({ status: "closed" }), row({ status: "draft", closedAt: null }), row({ status: "open", closedAt: null })];
    expect(sortRows(rows, "status", "asc").map((r) => r.status)).toEqual(["open", "draft", "closed"]);
  });
});

describe("the totals", () => {
  it("adds up people and initiatives as totals only, and reports participation", () => {
    const rows = [
      row({ initiatives: 8, stats: { invited: 10, voted: 7, applied: { at: "2027-02-12T10:00:00Z", moved: 2 } } }),
      row({ initiatives: 5, stats: { invited: 6, voted: 3 } }),
      row({ status: "draft", closedAt: null, initiatives: 4, stats: { invited: 0, voted: 0 } }),
    ];
    expect(summarize(rows)).toEqual({ sessions: 3, invited: 16, voted: 10, participation: 63, initiativesRanked: 13, applied: 1 });
    expect(participation({ invited: 0, voted: 0, mailingDraft: false, applied: null, undone: false })).toBeNull();
  });
  it("has no admin totals for rows without the admin-only values", () => {
    expect(summarize([row({ stats: null }), row({ stats: null })])).toMatchObject({ sessions: 2, invited: 0, voted: 0, participation: null, applied: 0 });
  });
});
