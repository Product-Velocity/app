import { describe, expect, it } from "vitest";
import { countBlockedStale, scheduleVariancePp } from "./delivery";

describe("scheduleVariancePp: progress minus the share of time elapsed", () => {
  const v = (p: number | null, today: string) => scheduleVariancePp(p, "2026-01-01", "2026-01-11", today);
  it("is positive when ahead, negative when behind, zero on plan", () => {
    expect(v(80, "2026-01-06")).toBe(30); // half the time gone, 80% done
    expect(v(20, "2026-01-06")).toBe(-30);
    expect(v(50, "2026-01-06")).toBe(0);
  });
  it("counts 0% elapsed before the start and 100% after the end", () => {
    expect(v(10, "2025-12-01")).toBe(10);
    expect(v(60, "2026-03-01")).toBe(-40);
    expect(v(100, "2026-03-01")).toBe(0);
  });
  it("is empty without progress, without both dates, or when the end is not after the start", () => {
    expect(v(null, "2026-01-06")).toBeNull();
    expect(scheduleVariancePp(50, null, "2026-01-11", "2026-01-06")).toBeNull();
    expect(scheduleVariancePp(50, "2026-01-01", null, "2026-01-06")).toBeNull();
    expect(scheduleVariancePp(50, "2026-01-11", "2026-01-11", "2026-01-11")).toBeNull();
    expect(scheduleVariancePp(50, "2026-02-01", "2026-01-11", "2026-01-11")).toBeNull();
    expect(scheduleVariancePp(Number.NaN, "2026-01-01", "2026-01-11", "2026-01-06")).toBeNull();
    expect(scheduleVariancePp(50, "soon", "2026-01-11", "2026-01-06")).toBeNull();
  });
  it("rounds to whole points", () => expect(scheduleVariancePp(33, "2026-01-01", "2026-01-04", "2026-01-02")).toBe(0)); // 33 - 33.3
});

describe("countBlockedStale", () => {
  const now = new Date("2026-02-01T12:00:00Z");
  const open = (over: object = {}) => ({ state: "open" as const, updatedAt: "2026-01-30T00:00:00Z", labels: [] as string[], ...over });
  it("counts open children with the blocked label, whatever its case", () => {
    expect(countBlockedStale([open({ labels: ["Blocked"] }), open({ labels: [" blocked "] }), open({ labels: ["blocker"] }), open()], now).blocked).toBe(2);
  });
  it("counts open children quiet for 14 days or more, and not a child whose activity is unknown", () => {
    const r = countBlockedStale([open({ updatedAt: "2026-01-17T11:59:00Z" }), open({ updatedAt: "2026-01-18T12:00:00Z" }), open({ updatedAt: null }), open({ updatedAt: "garbage" })], now);
    expect(r.stale).toBe(1);
  });
  it("never counts closed work, and the window can be changed", () => {
    expect(countBlockedStale([{ state: "closed", updatedAt: "2020-01-01T00:00:00Z", labels: ["blocked"] }], now)).toEqual({ blocked: 0, stale: 0 });
    expect(countBlockedStale([open({ updatedAt: "2026-01-25T00:00:00Z" })], now, 3).stale).toBe(1);
  });
  it("an empty tree is zero", () => expect(countBlockedStale([], now)).toEqual({ blocked: 0, stale: 0 }));
});
