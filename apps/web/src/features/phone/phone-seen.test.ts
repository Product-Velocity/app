import { describe, expect, it } from "vitest";
import type { ChangeRowData } from "@pv/domain";
import { changesSince, readLastLook, sinceWords, writeLastLook } from "./phone-seen";

const now = new Date("2026-11-23T12:00:00Z");
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
const r = (at: string, actorId: string | null = null) => ({ id: at, at, actorId }) as unknown as ChangeRowData;

describe("last look", () => {
  it("defaults to the last 3 days", () => expect(readLastLook(mem(), "t1", now).toISOString()).toBe("2026-11-20T12:00:00.000Z"));
  it("remembers the moment per workspace", () => {
    const s = mem();
    expect(writeLastLook(s, "t1", new Date("2026-11-22T08:00:00Z"))).toBe(true);
    expect(readLastLook(s, "t1", now).toISOString()).toBe("2026-11-22T08:00:00.000Z");
    expect(readLastLook(s, "t2", now).toISOString()).toBe("2026-11-20T12:00:00.000Z");
  });
  it("ignores a moment in the future and storage that throws", () => {
    const s = mem(); s.setItem("pv:last-look:t1", "2027-01-01T00:00:00Z");
    expect(readLastLook(s, "t1", now).toISOString()).toBe("2026-11-20T12:00:00.000Z");
    const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readLastLook(bad, "t1", now).toISOString()).toBe("2026-11-20T12:00:00.000Z");
    expect(writeLastLook(bad, "t1", now)).toBe(false);
    expect(writeLastLook(null, "t1", now)).toBe(false);
  });
});
describe("changesSince", () => {
  it("keeps newer changes by others and drops my own", () => {
    const rows = [r("2026-11-23T10:00:00Z"), r("2026-11-23T09:00:00Z", "me"), r("2026-11-19T09:00:00Z")];
    expect(changesSince(rows, new Date("2026-11-20T12:00:00Z"), "me").map((x) => x.at)).toEqual(["2026-11-23T10:00:00Z"]);
    expect(changesSince(rows, new Date("2026-11-20T12:00:00Z"), null)).toHaveLength(2);
  });
});
describe("sinceWords", () => {
  it("says it plainly", () => {
    expect(sinceWords(new Date("2026-11-23T06:00:00Z"), now)).toBe("since this morning");
    expect(sinceWords(new Date("2026-11-22T06:00:00Z"), now)).toBe("since yesterday");
    expect(sinceWords(new Date("2026-11-20T12:00:00Z"), now)).toBe("since Friday");
    expect(sinceWords(new Date("2026-11-01T12:00:00Z"), now)).toBe("since 1 Nov");
  });
});
