import { describe, expect, it } from "vitest";
import { RELOAD_WINDOW_MS, shouldReloadOnce } from "./reload-once";

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

describe("one automatic reload per address and minute", () => {
  it("reloads the first time, not again inside the minute, and again after it", () => {
    const s = memory();
    expect(shouldReloadOnce(s, "k", 1_000_000)).toBe(true);
    expect(shouldReloadOnce(s, "k", 1_000_000 + RELOAD_WINDOW_MS - 1)).toBe(false);
    expect(shouldReloadOnce(s, "k", 1_000_000 + RELOAD_WINDOW_MS + 1)).toBe(true);
  });
  it("each address has its own turn", () => {
    const s = memory();
    expect(shouldReloadOnce(s, "a", 5_000)).toBe(true);
    expect(shouldReloadOnce(s, "b", 5_000)).toBe(true);
  });
  it("never loops when storage is missing or throws", () => {
    expect(shouldReloadOnce(null, "k", 1)).toBe(false);
    expect(shouldReloadOnce({ getItem: () => { throw new Error("blocked"); }, setItem: () => undefined }, "k", 1)).toBe(false);
  });
});
