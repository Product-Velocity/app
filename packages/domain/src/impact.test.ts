import { describe, expect, it } from "vitest";
import { effortKr, hasKr } from "./impact";
import type { ReportRow } from "./reports";

const row = (o: Record<string, unknown>): ReportRow => ({ id: String(o.id ?? "x"), ...o }) as ReportRow;

describe("Primary KR (issue #233, module 3, V1)", () => {
  it("has a KR when it has a metric name or a target value", () => {
    expect(hasKr(row({ kr_metric: "Activation rate" }))).toBe(true);
    expect(hasKr(row({ kr_target: 40 }))).toBe(true);
    expect(hasKr(row({ kr_target: 0 }))).toBe(true);
    expect(hasKr(row({ kr_start: 10 }))).toBe(false);
    expect(hasKr(row({ kr_metric: "  " }))).toBe(false);
    expect(hasKr(row({}))).toBe(false);
  });
  it("counts initiatives with and without a KR per effort size, in T-shirt order, with Not set last", () => {
    const s = effortKr([
      row({ id: "a", effort: "M", kr_metric: "NPS", kr_start: 30, kr_target: 45, kr_unit: "count", kr_direction: "Increase" }),
      row({ id: "b", effort: "S" }),
      row({ id: "c", effort: "M" }),
      row({ id: "d", effort: "XS", kr_target: 5 }),
      row({ id: "e" }),
    ]);
    expect(s.sizes.map((g) => [g.key, g.total, g.withKr, g.withoutKr])).toEqual([["XS", 1, 1, 0], ["S", 1, 0, 1], ["M", 2, 1, 1], ["__none", 1, 0, 1]]);
    expect(s.withKr).toBe(2 + 0 + 0);
    expect(s.withoutKr).toBe(3);
    expect(s.total).toBe(5);
  });
  it("lists the KRs with their start, target, unit and direction, largest effort first", () => {
    const s = effortKr([
      row({ id: "a", effort: "S", kr_metric: "NPS", kr_start: 30, kr_target: 45, kr_unit: "count", kr_direction: "Increase" }),
      row({ id: "b", effort: "XL", kr_metric: "Churn", kr_start: 8, kr_target: 5, kr_unit: "%", kr_direction: "Decrease" }),
    ]);
    expect(s.krs.map((k) => [k.id, k.metric, k.start, k.target, k.unit, k.direction])).toEqual([["b", "Churn", 8, 5, "%", "Decrease"], ["a", "NPS", 30, 45, "count", "Increase"]]);
  });
  it("ignores values that are not numbers", () => {
    expect(effortKr([row({ id: "a", effort: "M", kr_metric: "X", kr_start: "ten", kr_target: null })]).krs[0]).toMatchObject({ start: null, target: null });
  });
});
