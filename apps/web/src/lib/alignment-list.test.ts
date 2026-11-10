import { describe, expect, it } from "vitest";
import { NO_FILTERS, NO_DATE, filterRows, needCounts, needsYou, participation, quarterOptions, quarterText, sortRows, summarize, type SessionRow } from "./alignment-list";

const NOW = new Date("2027-03-10T12:00:00Z");
let n = 0;
const row = (over: Partial<SessionRow> & { stats?: Partial<NonNullable<SessionRow["stats"]>> | null } = {}): SessionRow => {
  const { stats, ...rest } = over;
  n++;
  return {
    id: `s${n}`, name: `Session ${n}`, method: "coins", status: "closed", createdAt: `2027-01-${String(10 + n).padStart(2, "0")}T09:00:00Z`, openedAt: "2027-01-20T09:00:00Z",
    closesAt: "2027-02-10T17:00:00Z", closedAt: "2027-02-10T17:00:00Z", createdBy: "u1", initiatives: 8, itemNames: "Self-serve onboarding, Payout reconciliation", contested: 2,
    stats: stats === null ? null : { invited: 10, voted: 7, mailingDraft: false, applied: null, undone: false, ...stats },
    ...rest,
  };
};

describe("the quarter of a session", () => {
  it("is the quarter of the closing date, on the edges of the year and the quarter", () => {
    expect(quarterText(row({ closedAt: "2027-03-31T23:59:00Z" }))).toBe("Q1 2027");
    expect(quarterText(row({ closedAt: "2027-04-01T00:00:00Z" }))).toBe("Q2 2027");
    expect(quarterText(row({ closedAt: "2026-12-31T10:00:00Z" }))).toBe("Q4 2026");
    expect(quarterText(row({ closedAt: "2028-01-01T10:00:00Z" }))).toBe("Q1 2028");
  });
  it("uses the planned closing time while the session is open or a draft, and says so when there is none", () => {
    expect(quarterText(row({ status: "open", closedAt: null, closesAt: "2027-06-30T10:00:00Z" }))).toBe("Q2 2027");
    expect(quarterText(row({ status: "draft", closedAt: null, closesAt: null }))).toBe(NO_DATE);
  });
  it("a closed session without a closing date falls back to the planned time", () => {
    expect(quarterText(row({ status: "closed", closedAt: null, closesAt: "2027-08-01T00:00:00Z" }))).toBe("Q3 2027");
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
  const b = row({ name: "Roadmap vote", itemNames: "Payout reconciliation", method: "ice", status: "open", closedAt: null, closesAt: "2027-05-01T00:00:00Z", stats: { voted: 1 } });
  const c = row({ name: "Old vote", status: "archived", closedAt: "2026-06-01T00:00:00Z" });
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
    expect(filterRows(all, { ...NO_FILTERS, applied: "not-applied" }, NOW)).toEqual([a]);
    expect(filterRows(all, { ...NO_FILTERS, need: "not-applied", status: "closed" }, NOW)).toEqual([a]);
    expect(filterRows(all, { ...NO_FILTERS, q: "vote", method: "coins", showArchived: true }, NOW)).toEqual([c]);
  });
  it("lists the quarters present, oldest first, with no date last", () => {
    const d = row({ status: "draft", closedAt: null, closesAt: null });
    // a closed in Q1 2027, b is planned for Q2 2027, c closed in Q2 2026, d has no date
    expect(quarterOptions([...all, d])).toEqual(["Q2 2026", "Q1 2027", "Q2 2027", NO_DATE]);
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
  it("sorts quarters by year then quarter, not as text", () => {
    const q = (closedAt: string) => row({ closedAt });
    const rows = [q("2027-02-01T00:00:00Z"), q("2026-11-01T00:00:00Z"), q("2027-08-01T00:00:00Z")];
    expect(sortRows(rows, "quarter", "asc").map(quarterText)).toEqual(["Q4 2026", "Q1 2027", "Q3 2027"]);
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
