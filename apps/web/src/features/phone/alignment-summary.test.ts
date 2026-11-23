import { describe, expect, it } from "vitest";
import { orderSessions, summarizeSession, type SessionDb } from "./alignment-summary";

const snapshot = {
  voters: 12, items: [{ id: "a", name: "Self-serve onboarding" }, { id: "b", name: "Payout reconciliation" }, { id: "c", name: "Push digest" }],
  results: { joint: [{ itemId: "c", score: 50, place: 3, tied: false }, { itemId: "a", score: 90, place: 1, tied: false }, { itemId: "b", score: 90, place: 1, tied: true }], contested: [{ itemId: "a" }] },
};
const s = (o: Partial<SessionDb> = {}): SessionDb => ({ id: "s1", name: "Q1 planning", method: "coins", status: "closed", closed_at: "2027-02-10T17:00:00Z", closes_at: null, results_snapshot: snapshot, ...o });

describe("summarizeSession", () => {
  it("lists the top initiatives in place order with their names and ties", () => {
    const x = summarizeSession(s());
    expect(x.top.map((t) => `${t.place}${t.tied ? "=" : ""} ${t.name}`)).toEqual(["1 Self-serve onboarding", "1= Payout reconciliation", "3 Push digest"]);
    expect(x).toMatchObject({ final: true, voters: 12, contested: 1, method: "100 coins", more: 0 });
  });
  it("stops at the limit and says how many more there are", () => {
    const x = summarizeSession(s(), 2);
    expect(x.top).toHaveLength(2);
    expect(x.more).toBe(1);
  });
  it("shows no results for an open session", () => {
    const x = summarizeSession(s({ status: "open", closed_at: null, closes_at: "2027-03-01T00:00:00Z" }));
    expect(x).toMatchObject({ final: false, voters: null, top: [], contested: null, when: "2027-03-01T00:00:00Z" });
  });
  it("copes with a missing or odd results copy", () => {
    expect(summarizeSession(s({ results_snapshot: null })).top).toEqual([]);
    expect(summarizeSession(s({ results_snapshot: "x" })).voters).toBeNull();
    expect(summarizeSession(s({ results_snapshot: { items: [], results: { joint: [{ itemId: "zz", score: 1, place: 1, tied: false }] } } })).top).toEqual([]);
  });
});

describe("orderSessions", () => {
  it("puts closed sessions first, newest first, and leaves out drafts", () => {
    const rows = [s({ id: "open", status: "open", closed_at: null, closes_at: "2027-03-01T00:00:00Z" }), s({ id: "old", closed_at: "2026-12-01T00:00:00Z" }), s({ id: "new", closed_at: "2027-02-10T00:00:00Z" }), s({ id: "draft", status: "draft" })];
    expect(orderSessions(rows).map((r) => r.id)).toEqual(["new", "old", "open"]);
  });
});
