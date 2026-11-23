import { describe, expect, it } from "vitest";
import { chartFileName, wrapText } from "./chart-export";
import { reportPdfTitle } from "./print-report";

describe("report exports (issue #622)", () => {
  it("names a PNG after its chart and the day", () => {
    expect(chartFileName("Initiatives by Team and Phase", "2026-11-23")).toBe("initiatives-by-team-and-phase-2026-11-23.png");
    expect(chartFileName("  Time to Market (days) ", "2026-11-23")).toBe("time-to-market-days-2026-11-23.png");
    expect(chartFileName("???", "2026-11-23")).toBe("chart-2026-11-23.png");
  });
  it("wraps a long title at the width and never splits a word", () => {
    const measure = (s: string) => s.length * 10;
    expect(wrapText("Median days spent in each phase", 150, measure)).toEqual(["Median days", "spent in each", "phase"]);
    expect(wrapText("Supercalifragilistic", 50, measure)).toEqual(["Supercalifragilistic"]);
    expect(wrapText("", 50, measure)).toEqual([]);
  });
  it("suggests a PDF name that says what and when", () => {
    expect(reportPdfTitle("Roadmap Health", "2026-11-23")).toBe("Product Velocity - Reports - Roadmap Health - 2026-11-23");
  });
});
