import { describe, expect, it } from "vitest";
import { percentOf } from "./field-visuals";

describe("percentOf", () => {
  it("reads whole numbers, words with a percent sign and shares", () => {
    expect(percentOf(42)).toBe(42);
    expect(percentOf("25%")).toBe(25);
    expect(percentOf(0.5)).toBe(50);
  });
  it("clamps and rejects what is not a number", () => {
    expect(percentOf(140)).toBe(100);
    expect(percentOf(-5)).toBe(0);
    expect(percentOf("n/a")).toBeNull();
    expect(percentOf(null)).toBeNull();
  });
});
