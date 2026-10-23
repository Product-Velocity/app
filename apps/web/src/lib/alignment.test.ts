import { describe, expect, it } from "vitest";
import { NEXT_STATE, parseGroups, validateSettings } from "./alignment";

const base = { name: "Q1 priorities", method: "coins", groups: "Engineering\nSales", weighting: "equal", excluded: [], coinsTotal: 100, coinsMax: 30, showResults: false, retention: 12, closesAt: "" };
const now = Date.parse("2026-10-24T10:00:00Z");

describe("groups", () => {
  it("one name per line; blanks and duplicates dropped; stable ids", () => {
    expect(parseGroups(" Engineering \n\nSales\nsales\nNorth America")).toEqual([{ id: "engineering", name: "Engineering" }, { id: "sales", name: "Sales" }, { id: "north-america", name: "North America" }]);
  });
  it("needs at least one and at most twelve", () => {
    expect(parseGroups("  \n ")).toMatchObject({ error: expect.any(String) });
    expect(parseGroups(Array.from({ length: 13 }, (_, i) => `G${i}`).join("\n"))).toMatchObject({ error: expect.any(String) });
  });
});

describe("settings", () => {
  it("accepts a good form and normalises it", () => {
    const r = validateSettings({ ...base, closesAt: "2026-11-01T09:00:00Z", showResults: "on" }, now);
    expect(r).toMatchObject({ ok: true, settings: { name: "Q1 priorities", weighting: "equal", showResults: true, closesAt: "2026-11-01T09:00:00.000Z" } });
  });
  it("refuses the things the database would", () => {
    expect(validateSettings({ ...base, name: "  " }, now)).toMatchObject({ ok: false });
    expect(validateSettings({ ...base, method: "vote" }, now)).toMatchObject({ ok: false });
    expect(validateSettings({ ...base, coinsMax: 120 }, now)).toMatchObject({ ok: false });
    expect(validateSettings({ ...base, coinsTotal: 5 }, now)).toMatchObject({ ok: false });
    expect(validateSettings({ ...base, retention: 0 }, now)).toMatchObject({ ok: false });
    expect(validateSettings({ ...base, closesAt: "2026-10-01T09:00:00Z" }, now)).toMatchObject({ ok: false, error: expect.stringContaining("future") });
    expect(validateSettings({ ...base, excluded: ["engineering", "sales"] }, now)).toMatchObject({ ok: false });
  });
  it("ignores excluded ids that are not groups of the session", () => {
    expect(validateSettings({ ...base, excluded: ["sales", "ghost"] }, now)).toMatchObject({ ok: true, settings: { excluded: ["sales"] } });
  });
});

describe("states", () => {
  it("go forward one step at a time and archived is the end", () => {
    expect(NEXT_STATE.draft?.to).toBe("open");
    expect(NEXT_STATE.open?.to).toBe("closed");
    expect(NEXT_STATE.closed?.to).toBe("archived");
    expect(NEXT_STATE.archived).toBeNull();
  });
});
