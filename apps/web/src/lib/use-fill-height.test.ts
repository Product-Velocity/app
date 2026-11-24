import { describe, expect, it } from "vitest";
import { fillHeight } from "./use-fill-height";

describe("fillHeight: a grid fills the page below it", () => {
  it("is the window minus the grid's top, the footer line and a margin", () => {
    expect(fillHeight(1000, 300, 30)).toBe(634);
  });
  it("follows a taller window", () => {
    expect(fillHeight(1400, 300, 30)).toBeGreaterThan(fillHeight(1000, 300, 30));
  });
  it("never gets smaller than the minimum, so a short window scrolls the page instead", () => {
    expect(fillHeight(500, 300, 30)).toBe(360);
    expect(fillHeight(500, 300, 30, 200)).toBe(200);
  });
});
