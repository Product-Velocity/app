import { describe, expect, it } from "vitest";
import { ciValue, countPullRequests, formatRelease, pickLatestRelease, repositoriesText } from "./delivery";

describe("countPullRequests", () => {
  it("counts open and merged, and a closed unmerged one as neither", () => {
    expect(countPullRequests([{ repo: "A/a", number: 1, state: "open" }, { repo: "A/a", number: 2, state: "merged" }, { repo: "A/a", number: 3, state: "closed" }])).toEqual({ open: 1, merged: 1 });
  });
  it("counts a pull request linked from several issues once, ignoring the case of the repository", () => {
    expect(countPullRequests([{ repo: "A/a", number: 1, state: "open" }, { repo: "a/A", number: 1, state: "open" }])).toEqual({ open: 1, merged: 0 });
  });
  it("when two answers disagree the later state of the pull request wins (merged beats closed beats open)", () => {
    expect(countPullRequests([{ repo: "A/a", number: 1, state: "open" }, { repo: "A/a", number: 1, state: "merged" }])).toEqual({ open: 0, merged: 1 });
    expect(countPullRequests([{ repo: "A/a", number: 1, state: "closed" }, { repo: "A/a", number: 1, state: "open" }])).toEqual({ open: 0, merged: 0 });
  });
  it("nothing is zero", () => expect(countPullRequests([])).toEqual({ open: 0, merged: 0 }));
});

describe("ciValue", () => {
  it("maps GitHub's rollup to Passing, Failing or None, and leaves a running check unchanged", () => {
    expect(ciValue("SUCCESS")).toBe("Passing");
    expect(ciValue("FAILURE")).toBe("Failing");
    expect(ciValue("ERROR")).toBe("Failing");
    expect(ciValue(null)).toBe("None");
    expect(ciValue(undefined)).toBe("None");
    expect(ciValue("PENDING")).toBeNull();
    expect(ciValue("EXPECTED")).toBeNull();
    expect(ciValue("SOMETHING_NEW")).toBeNull();
  });
});

describe("pickLatestRelease and formatRelease", () => {
  const r = (repo: string, tag: string, publishedAt: string) => ({ repo, tag, name: null, publishedAt });
  const all = [r("A/a", "v1.0.0", "2026-09-01T10:00:00Z"), r("A/b", "v2.1.0", "2026-10-20T08:00:00Z"), r("A/a", "v1.1.0", "2026-10-05T08:00:00Z")];
  it("is the latest of all releases when the item has not started", () => expect(pickLatestRelease(all, null)?.tag).toBe("v2.1.0"));
  it("only counts releases published since the item started", () => {
    expect(pickLatestRelease(all, "2026-10-10")?.tag).toBe("v2.1.0");
    expect(pickLatestRelease(all, "2026-10-21")).toBeNull();
    expect(pickLatestRelease([r("A/a", "v1", "garbage")], null)).toBeNull();
    expect(pickLatestRelease([], null)).toBeNull();
  });
  it("reads as tag and date, with the repository when several are involved", () => {
    expect(formatRelease(all[1]!)).toBe("v2.1.0 · 2026-10-20");
    expect(formatRelease(all[1]!, true)).toBe("A/b v2.1.0 · 2026-10-20");
    expect(formatRelease({ repo: "A/a", tag: "", name: "Big one", publishedAt: "2026-10-20T00:00:00Z" })).toBe("Big one · 2026-10-20");
  });
});

describe("repositoriesText", () => {
  it("lists each repository once (case ignored), sorted", () => expect(repositoriesText(["Acme/web", "acme/WEB", "Acme/api", ""])).toBe("Acme/api, Acme/web"));
  it("is cut at 500 characters", () => expect(repositoriesText(Array.from({ length: 100 }, (_, i) => `Acme/repository-${i}`)).length).toBeLessThanOrEqual(500));
});
