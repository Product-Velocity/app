import { describe, expect, it } from "vitest";
import { agoLabel, latestTime } from "./last-sync";

describe("latestTime", () => {
  it("picks the latest valid time and ignores everything else", () => {
    expect(latestTime(["2026-10-27T10:00:00Z", null, "garbage", 5, "2026-10-27T12:30:00Z", "2026-10-26T23:00:00Z"])).toBe("2026-10-27T12:30:00Z");
    expect(latestTime([])).toBeNull();
    expect(latestTime([null, undefined, "soon"])).toBeNull();
  });
});

describe("agoLabel", () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  const at = (secondsAgo: number) => new Date(now - secondsAgo * 1000).toISOString();
  it("reads in words, from just now to days", () => {
    expect(agoLabel(at(20), now)).toBe("just now");
    expect(agoLabel(at(90), now)).toBe("2 minutes ago");
    expect(agoLabel(at(240), now)).toBe("4 minutes ago");
    expect(agoLabel(at(60 * 60), now)).toBe("1 hour ago");
    expect(agoLabel(at(5 * 3600), now)).toBe("5 hours ago");
    expect(agoLabel(at(3 * 86_400), now)).toBe("3 days ago");
  });
  it("a time in the future is just now", () => expect(agoLabel(at(-500), now)).toBe("just now"));
});
