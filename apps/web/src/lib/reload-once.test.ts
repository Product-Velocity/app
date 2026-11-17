import { describe, expect, it } from "vitest";
import { RELOAD_WINDOW_MS, describeLoadError, shouldReloadOnce } from "./reload-once";

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

describe("what is shown after the reload", () => {
  it("names the time, the address, the message, the reference and the top of the stack, and stays short", () => {
    const t = describeLoadError({ message: "boom", digest: "123", stack: "Error: boom\n  at a (x.js:1:1)\n  at b (y.js:2:2)" }, "/w/abc/cards", new Date("2026-11-17T22:00:00Z"));
    expect(t).toContain("2026-11-17T22:00:00.000Z /w/abc/cards");
    expect(t).toContain("boom (reference 123)");
    expect(t).toContain("at a (x.js:1:1)");
    expect(describeLoadError({ message: "x".repeat(5000) }, "/", new Date()).length).toBeLessThanOrEqual(900);
  });
});
