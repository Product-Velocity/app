import { describe, expect, it } from "vitest";
import { formatValue, parseValue } from "./money";

const n = (s: string) => {
  const r = parseValue(s);
  return r.ok ? r.value : `ERR:${r.error}`;
};

describe("parseValue", () => {
  it("accepts plain numbers and thousands separators", () => {
    expect(n("1200")).toBe(1200);
    expect(n("1,200")).toBe(1200);
    expect(n("1,200,000")).toBe(1200000);
    expect(n("1 200 000")).toBe(1200000);
    expect(n("1200.5")).toBe(1200.5);
    expect(n("0")).toBe(0);
  });
  it("accepts k and m suffixes and currency signs", () => {
    expect(n("120k")).toBe(120000);
    expect(n("1.2m")).toBe(1200000);
    expect(n("€ 450K")).toBe(450000);
    expect(n("2,5k")).toBe(2500); // comma as decimal mark
    expect(n("$3M")).toBe(3000000);
  });
  it("clears on empty input", () => {
    expect(parseValue("")).toEqual({ ok: true, value: null });
  });
  it.each(["-5", "abc", "12k5", "1.2.3", "1e30", "9999999999999"])("rejects %j", (bad) => {
    expect(parseValue(bad).ok).toBe(false);
  });
  it("rounds to 2 decimals", () => {
    expect(n("1.005k")).toBe(1005);
    expect(n("0.126")).toBe(0.13);
  });
});

describe("formatValue", () => {
  it("groups thousands and drops empty decimals", () => {
    expect(formatValue(120000)).toBe("120,000");
    expect(formatValue(1200.5)).toBe("1,200.5");
    expect(formatValue(0)).toBe("0");
    expect(formatValue(null)).toBe("");
  });
});
