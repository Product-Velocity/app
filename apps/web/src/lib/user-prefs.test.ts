import { describe, expect, it } from "vitest";
import { TEXT_SIZES, TEXT_SIZE_DEFAULT, clampTextSize, stepTextSize, textSizeFromMetadata, PANEL_WIDTH_DEFAULT, PANEL_WIDTH_MAX, PANEL_WIDTH_MIN, clampPanelWidth, lastLocationFromMetadata, panelWidthFromMetadata, sanitizeLocation, withLastLocation } from "./user-prefs";

describe("panel width", () => {
  it("stays between the limits and whole", () => {
    expect(clampPanelWidth(10)).toBe(PANEL_WIDTH_MIN);
    expect(clampPanelWidth(5000)).toBe(PANEL_WIDTH_MAX);
    expect(clampPanelWidth(640.6)).toBe(641);
    expect(clampPanelWidth(Number.NaN)).toBe(PANEL_WIDTH_DEFAULT);
  });
  it("never takes more than 70% of a known window", () => {
    expect(clampPanelWidth(1000, 1000)).toBe(700);
    expect(clampPanelWidth(1000, 300)).toBe(PANEL_WIDTH_MIN);
  });
  it("reads the stored value with a default", () => {
    expect(panelWidthFromMetadata({ panel_width: 700 })).toBe(700);
    expect(panelWidthFromMetadata({ panel_width: "700" })).toBe(PANEL_WIDTH_DEFAULT);
    expect(panelWidthFromMetadata(null)).toBe(PANEL_WIDTH_DEFAULT);
  });
});

describe("last location", () => {
  it("keeps the screen and the view, drops everything else", () => {
    expect(sanitizeLocation("/gantt?view=abc&item=R-01&scope=p:1")).toBe("/gantt?view=abc&scope=p%3A1");
    expect(sanitizeLocation("/portfolio/")).toBe("/portfolio");
    expect(sanitizeLocation("/portfolio?item=R-01")).toBe("/portfolio");
  });
  it("refuses anything that is not a known screen or could leave the app", () => {
    for (const bad of ["/portfolio/R-01", "/settings/members", "//evil.com", "https://evil.com/portfolio", "portfolio", "/account", "/w/x/portfolio", 5, null, "/portfolio" + "a".repeat(500)]) {
      expect(sanitizeLocation(bad)).toBeNull();
    }
  });
  it("is stored per account and read back", () => {
    const a = "11111111-1111-1111-1111-111111111111";
    const b = "22222222-2222-2222-2222-222222222222";
    const meta = { last_location: withLastLocation({}, a, "/gantt?view=v1") };
    expect(lastLocationFromMetadata(meta, a)).toBe("/gantt?view=v1");
    expect(lastLocationFromMetadata(meta, b)).toBeNull();
    const both = { last_location: withLastLocation(meta, b, "/cards") };
    expect(lastLocationFromMetadata(both, a)).toBe("/gantt?view=v1");
    expect(lastLocationFromMetadata(both, b)).toBe("/cards");
  });
  it("keeps at most 12 accounts", () => {
    let meta: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++) meta = { last_location: withLastLocation(meta, `t${i}`, "/portfolio") };
    expect(Object.keys(meta.last_location as object)).toHaveLength(12);
    expect(lastLocationFromMetadata(meta, "t19")).toBe("/portfolio");
    expect(lastLocationFromMetadata(meta, "t0")).toBeNull();
  });
});

describe("text size", () => {
  it("snaps any value to an allowed step and defaults to 100", () => {
    expect(clampTextSize(undefined)).toBe(TEXT_SIZE_DEFAULT);
    expect(clampTextSize("big")).toBe(TEXT_SIZE_DEFAULT);
    expect(clampTextSize(5)).toBe(TEXT_SIZES[0]);
    expect(clampTextSize(500)).toBe(TEXT_SIZES[TEXT_SIZES.length - 1]);
    expect(clampTextSize(112)).toBe(110);
  });
  it("steps one at a time and stops at both ends", () => {
    expect(stepTextSize(100, 1)).toBe(110);
    expect(stepTextSize(100, -1)).toBe(90);
    expect(stepTextSize(90, -1)).toBe(90);
    expect(stepTextSize(130, 1)).toBe(130);
  });
  it("reads the saved value from the profile", () => {
    expect(textSizeFromMetadata({ text_size: 120 })).toBe(120);
    expect(textSizeFromMetadata(null)).toBe(100);
  });
});
