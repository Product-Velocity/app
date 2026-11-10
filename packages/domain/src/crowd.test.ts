import { describe, expect, it } from "vitest";
import { agreementText, crowdFields, crowdHistory, latestCrowd, placeLabel, toCrowdRow, type CrowdRow } from "./crowd";

const row = (over: Partial<CrowdRow>): CrowdRow => ({ itemId: "i1", sessionId: "s1", sessionName: "Q1", method: "coins", closedAt: "2027-01-10T10:00:00Z", place: 1, tied: false, score: 100, ofItems: 5, voters: 12, contested: false, highGroup: null, lowGroup: null, spread: null, consensus: 90, ...over });

describe("the current result and the history of an initiative", () => {
  const rows = [
    row({ sessionId: "old", closedAt: "2027-01-10T10:00:00Z", place: 3 }),
    row({ sessionId: "new", closedAt: "2027-03-01T10:00:00Z", place: 1 }),
    row({ itemId: "i2", sessionId: "only", closedAt: "2027-02-01T10:00:00Z", place: 2 }),
  ];
  it("puts the most recently closed session first, and keeps the earlier one", () => {
    expect(crowdHistory(rows, "i1").map((r) => r.sessionId)).toEqual(["new", "old"]);
  });
  it("takes the latest per initiative as the current result", () => {
    const latest = latestCrowd(rows);
    expect(latest.get("i1")!.sessionId).toBe("new");
    expect(latest.get("i2")!.sessionId).toBe("only");
    expect(latest.has("i3")).toBe(false);
  });
  it("breaks a same-time tie the same way every time", () => {
    const same = [row({ sessionId: "b" }), row({ sessionId: "a" })];
    expect(crowdHistory(same, "i1").map((r) => r.sessionId)).toEqual(crowdHistory([...same].reverse(), "i1").map((r) => r.sessionId));
  });
});

describe("the grid fields", () => {
  it("maps rank, score, consensus and the total of voters", () => {
    expect(crowdFields(row({ place: 2, score: 71.4, consensus: 40, voters: 9 }))).toEqual({ crowd_rank: 2, crowd_score: 71.4, crowd_consensus: 40, crowd_votes: 9 });
  });
  it("is empty without a result, and consensus stays empty when no group is shown", () => {
    expect(crowdFields(undefined)).toEqual({ crowd_rank: null, crowd_score: null, crowd_consensus: null, crowd_votes: null });
    expect(crowdFields(row({ consensus: null })).crowd_consensus).toBeNull();
  });
});

describe("wording", () => {
  it("writes a tie with an equals sign", () => {
    expect(placeLabel({ place: 2, tied: true })).toBe("=2");
    expect(placeLabel({ place: 2, tied: false })).toBe("2");
  });
  it("names the groups of a contested initiative and gives the gap", () => {
    expect(agreementText(row({ contested: true, highGroup: "Engineering", lowGroup: "Sales", spread: 60, consensus: 40 }))).toBe("Contested: Engineering rate it high, Sales low (gap 60 of 100).");
  });
  it("says groups are not shown instead of guessing, and reports agreement otherwise", () => {
    expect(agreementText(row({ consensus: null }))).toMatch(/fewer than 5 voters/);
    expect(agreementText(row({ consensus: 87.6 }))).toMatch(/broadly agree \(consensus 88 of 100\)/);
  });
});

describe("reading a database row", () => {
  it("turns numeric strings into numbers and keeps empty values empty", () => {
    const r = toCrowdRow({ item_id: "i", session_id: "s", session_name: "Q", method: "ice", closed_at: "2027-01-01T00:00:00Z", place: 2, tied: true, score: "71.40", of_items: 8, voters: 12, contested: false, high_group: null, low_group: null, spread: null, consensus: null });
    expect(r).toMatchObject({ place: 2, tied: true, score: 71.4, ofItems: 8, voters: 12, spread: null, consensus: null });
  });
});
