import { describe, expect, it } from "vitest";
import { NO_QUARTER } from "./alignment-list";
import { NOT_SET, NO_PICK_FILTERS, filterInitiatives, pickerQuarters, stageCounts, type Initiative } from "./alignment-pick";

const i = (over: Partial<Initiative> & { id: string }): Initiative => ({ code: `R-${over.id}`, name: `Initiative ${over.id}`, project: "Growth", phase: "Define", moscow: "Must", quarter: "Q1 2027", ready: false, ...over });
const list = [
  i({ id: "1", name: "Self-serve onboarding", phase: "Discover", moscow: "Must", quarter: "Q1 2027" }),
  i({ id: "2", name: "Bidder dashboard", phase: "Define", moscow: "Should", quarter: "Q1 2027", project: "Marketplace" }),
  i({ id: "3", name: "Host-read scheduling", phase: "Build", moscow: "Must", quarter: "Q2 2027", ready: true, project: "Marketplace" }),
  i({ id: "4", name: "Search relevance", phase: "Define", moscow: null, quarter: null }),
  i({ id: "5", name: "Payout reconciliation", phase: "Test", moscow: "Won't", quarter: "Q4 2026" }),
];
const ids = (xs: Initiative[]) => xs.map((x) => x.id);

describe("picking initiatives for a session", () => {
  it("shows everything without filters", () => {
    expect(ids(filterInitiatives(list, NO_PICK_FILTERS))).toEqual(["1", "2", "3", "4", "5"]);
  });
  it("filters by planned quarter, including the ones without one", () => {
    expect(ids(filterInitiatives(list, { ...NO_PICK_FILTERS, quarter: "Q1 2027" }))).toEqual(["1", "2"]);
    expect(ids(filterInitiatives(list, { ...NO_PICK_FILTERS, quarter: NO_QUARTER }))).toEqual(["4"]);
  });
  it("filters by MoSCoW, including not set", () => {
    expect(ids(filterInitiatives(list, { ...NO_PICK_FILTERS, moscow: "Must" }))).toEqual(["1", "3"]);
    expect(ids(filterInitiatives(list, { ...NO_PICK_FILTERS, moscow: NOT_SET }))).toEqual(["4"]);
  });
  it("the stages are an 'or': Discover, the PRD (Define) and Ready for build", () => {
    expect(ids(filterInitiatives(list, { ...NO_PICK_FILTERS, stages: ["discover"] }))).toEqual(["1"]);
    expect(ids(filterInitiatives(list, { ...NO_PICK_FILTERS, stages: ["prd"] }))).toEqual(["2", "4"]);
    expect(ids(filterInitiatives(list, { ...NO_PICK_FILTERS, stages: ["ready"] }))).toEqual(["3"]);
    expect(ids(filterInitiatives(list, { ...NO_PICK_FILTERS, stages: ["discover", "prd", "ready"] }))).toEqual(["1", "2", "3", "4"]);
  });
  it("everything else is an 'and': the combination people ask for most (a planned quarter, Must, and the stages)", () => {
    const f = { ...NO_PICK_FILTERS, quarter: "Q1 2027", moscow: "Must", stages: ["discover" as const, "prd" as const, "ready" as const] };
    expect(ids(filterInitiatives(list, f))).toEqual(["1"]);
    expect(ids(filterInitiatives(list, { ...f, project: "Marketplace" }))).toEqual([]);
    expect(ids(filterInitiatives(list, { ...NO_PICK_FILTERS, q: "dashboard", project: "Marketplace" }))).toEqual(["2"]);
    expect(ids(filterInitiatives(list, { ...NO_PICK_FILTERS, q: "r-3" }))).toEqual(["3"]);
  });
  it("lists the planned quarters in use, oldest first, with none last, and counts the stages", () => {
    expect(pickerQuarters(list)).toEqual(["Q4 2026", "Q1 2027", "Q2 2027", NO_QUARTER]);
    expect(pickerQuarters(list.filter((x) => x.quarter))).toEqual(["Q4 2026", "Q1 2027", "Q2 2027"]);
    expect(stageCounts(list)).toEqual({ discover: 1, prd: 2, ready: 1 });
  });
});
