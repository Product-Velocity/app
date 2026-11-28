import { describe, expect, it } from "vitest";
import { cardRows, cleanVoterFields, formatValue } from "./voter-card";

describe("voter card", () => {
  it("keeps only known fields, once, in the card's order", () => {
    expect(cleanVoterFields(["effort", "business_line", "effort", "revenue", 3])).toEqual(["business_line", "effort"]);
    expect(cleanVoterFields(undefined)).toEqual([]);
  });
  it("formats the value in the workspace currency, and falls back to a plain number", () => {
    expect(formatValue(150000, "EUR")).toBe("€150,000");
    expect(formatValue("150000.00", "usd")).toBe("150,000");
    expect(formatValue(1234.5, null)).toBe("1,235");
  });
  it("shows only what the snapshot holds", () => {
    expect(cardRows({ businessLine: "Direct", businessValue: 250000, effort: "M" }, "EUR")).toEqual([
      { label: "Business Line", value: "Direct" }, { label: "Business Value (12 months)", value: "€250,000" }, { label: "Effort", value: "M" },
    ]);
    expect(cardRows({ businessLine: null, businessValue: null, effort: "XL" }, "EUR")).toEqual([{ label: "Effort", value: "XL" }]);
    expect(cardRows({ businessLine: "  ", businessValue: "", effort: null }, "EUR")).toEqual([]);
    expect(cardRows({ businessLine: null, businessValue: 0, effort: null }, "EUR")).toEqual([{ label: "Business Value (12 months)", value: "€0" }]);
  });
});
