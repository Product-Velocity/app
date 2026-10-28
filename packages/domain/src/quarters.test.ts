import { describe, expect, it } from "vitest";
import { generatedQuarters, isQuarter, parseQuarter, quarterChoices, quarterMismatch, quarterOfDate } from "./quarters";
import { FIELD_BY_KEY } from "./registry";
import { guessMapping } from "./spreadsheet";
import { buildGroupedRows, sortRows } from "./views";
import { optionsFor, validateEdit, readOnlyReason, EDITABLE_FIELDS, bulkEditReason } from "./fields";

const today = new Date("2026-10-28T12:00:00Z");

describe("Planned Quarter values", () => {
  it("parses calendar quarters in a few spellings and nothing else", () => {
    expect(parseQuarter("Q3 2027")).toBe("Q3 2027");
    expect(parseQuarter("q3 2027")).toBe("Q3 2027");
    expect(parseQuarter("2027-Q3")).toBe("Q3 2027");
    expect(parseQuarter("Q5 2027")).toBeNull();
    expect(parseQuarter("FY27 Q3")).toBeNull();
    expect(parseQuarter("2027")).toBeNull();
    expect(isQuarter("Q1 2027")).toBe(true);
    expect(isQuarter("Q0 2027")).toBe(false);
  });
  it("maps a date to its calendar quarter", () => {
    expect(quarterOfDate("2027-03-31")).toBe("Q1 2027");
    expect(quarterOfDate("2027-04-01")).toBe("Q2 2027");
    expect(quarterOfDate("2027-12-31")).toBe("Q4 2027");
    expect(quarterOfDate(null)).toBeNull();
  });
  it("offers the previous year through the next three years, at least 16 quarters, moving forward with time", () => {
    const list = generatedQuarters(today);
    expect(list).toHaveLength(20);
    expect(list[0]).toBe("Q1 2025");
    expect(list.at(-1)).toBe("Q4 2029");
    expect(generatedQuarters(new Date("2027-02-01T00:00:00Z"))[0]).toBe("Q1 2026");
  });
  it("keeps a value in use selectable after it leaves the generated range, in time order", () => {
    const c = quarterChoices(["Q2 2019", "Q3 2027", "not a quarter"], today);
    expect(c[0]).toBe("Q2 2019");
    expect(c.filter((v) => v === "Q3 2027")).toHaveLength(1);
    expect(c).not.toContain("not a quarter");
  });
  it("hints only when both are set and the date is outside the quarter", () => {
    expect(quarterMismatch("Q3 2027", "2027-10-02")).toBe(true);
    expect(quarterMismatch("Q3 2027", "2027-08-02")).toBe(false);
    expect(quarterMismatch(null, "2027-08-02")).toBe(false);
    expect(quarterMismatch("Q3 2027", null)).toBe(false);
  });
});

describe("Planned Quarter as a field", () => {
  it("is the Planned Quarter select under the same key, editable in the grid and in bulk", () => {
    const f = FIELD_BY_KEY.g2m_quarter!;
    expect(f.name).toBe("Planned Quarter");
    expect(f.type).toBe("Select");
    expect(f.group).toBe("When");
    expect(EDITABLE_FIELDS).toContain("g2m_quarter");
    expect(readOnlyReason("g2m_quarter")).toBeNull();
    expect(bulkEditReason("g2m_quarter")).toBeNull();
  });
  it("lists the generated quarters as its allowed values and options", () => {
    expect(FIELD_BY_KEY.g2m_quarter!.allowed.length).toBeGreaterThanOrEqual(16);
    expect(optionsFor("g2m_quarter").map((o) => o.value)).toEqual(FIELD_BY_KEY.g2m_quarter!.allowed);
  });
  it("accepts any calendar quarter, normalises it, and clears to Unscheduled", () => {
    expect(validateEdit("g2m_quarter", "q3 2027")).toEqual({ ok: true, value: "Q3 2027" });
    expect(validateEdit("g2m_quarter", "Q1 2019")).toEqual({ ok: true, value: "Q1 2019" });
    expect(validateEdit("g2m_quarter", "")).toEqual({ ok: true, value: null });
    expect(validateEdit("g2m_quarter", "FY27")).toMatchObject({ ok: false });
  });
});

describe("Planned Quarter in imports, sorting and grouping", () => {
  it("maps the old import header G2M Quarter, and Planned Quarter, to the field", () => {
    expect(guessMapping(["G2M Quarter"])).toEqual(["g2m_quarter"]);
    expect(guessMapping(["Planned Quarter"])).toEqual(["g2m_quarter"]);
    expect(guessMapping(["Quarter"])).toEqual(["g2m_quarter"]);
  });
  it("offers quarters in use in time order, and sorts and groups across years by time, not by text", () => {
    const rows = [
      { id: "a", g2m_quarter: "Q1 2028", stack_rank: 1 }, { id: "b", g2m_quarter: "Q2 2027", stack_rank: 2 },
      { id: "c", g2m_quarter: null, stack_rank: 3 }, { id: "d", g2m_quarter: "Q4 2019", stack_rank: 4 },
    ];
    expect(sortRows(rows, { field: "g2m_quarter", dir: "asc" }).map((r) => r.id)).toEqual(["d", "b", "a", "c"]);
    expect(sortRows(rows, { field: "g2m_quarter", dir: "desc" }).map((r) => r.id)).toEqual(["a", "b", "d", "c"]);
    const grouped = buildGroupedRows(rows, "g2m_quarter", new Set(), (_f, v) => String(v ?? "Unscheduled"));
    expect(grouped.filter((g) => "__group" in g).map((g) => (g as { label: string }).label)).toEqual(["Q4 2019", "Q2 2027", "Q1 2028", "Unscheduled"]);
  });
});
