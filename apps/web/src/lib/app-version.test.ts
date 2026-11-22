import { describe, expect, it } from "vitest";
import {
  compareVersions,
  formatReleaseDate,
  groupReleases,
  hasVersionUpdate,
  inferReleaseType,
  parseReleaseLog,
  releasesSince,
  splitReleaseCell,
} from "./app-version";

const SAMPLE_RELEASES = `# Release log

| Version | Date | Key updates | PRs |
|---|---|---|---|
| 0.114.0 | 2026-11-09 | **Manual update prompt and What's new dialog.** The app checks for newly deployed versions and offers a Refresh button and release summary. | #370 |
| 0.113.0 | 2026-11-09 | **Native Gemini PRD and Discovery skills.** Added native Gemini and Antigravity skills (\`product-velocity-prd\`) for guided PRD authoring. | #369 |
| 0.112.0 | 2026-11-09 | **Incoming has a Re-pull button for issues you already pulled in.** On the Pulled in tab, tick initiatives and press Re-pull. | #368 |
`;

describe("app-version helpers", () => {
  it("extracts bold title and full summary from a release cell", () => {
    const out = splitReleaseCell("**Native Gemini skills.** Added `product-velocity-prd` and `discovery` skills.");
    expect(out.title).toBe("Native Gemini skills");
    expect(out.summary).toBe("Native Gemini skills. Added product-velocity-prd and discovery skills.");
  });

  it("parses the markdown table in docs/RELEASES.md up to the requested limit", () => {
    const entries = parseReleaseLog(SAMPLE_RELEASES, 2);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      version: "0.114.0",
      date: "2026-11-09",
      title: "Manual update prompt and What's new dialog",
      summary: "Manual update prompt and What's new dialog. The app checks for newly deployed versions and offers a Refresh button and release summary.",
      body: "The app checks for newly deployed versions and offers a Refresh button and release summary.",
      type: "improved",
      pr: "#370",
    });
    expect(entries[1]?.version).toBe("0.113.0");
  });

  it("reads the type mark and keeps the description apart from the title", () => {
    const out = splitReleaseCell("<!--type:new--> **Dark mode.** Switch it on in Settings.");
    expect(out).toEqual({ title: "Dark mode", summary: "Dark mode. Switch it on in Settings.", body: "Switch it on in Settings.", type: "new" });
  });

  it("classifies entries without a mark from their wording", () => {
    expect(inferReleaseType("Fix: the button was invisible")).toBe("fixed");
    expect(inferReleaseType("Fixed sign in")).toBe("fixed");
    expect(inferReleaseType("New homepage story")).toBe("new");
    expect(inferReleaseType("Gantt opens on today")).toBe("improved");
    expect(inferReleaseType("Prefix of a word")).toBe("improved");
  });

  it("writes dates in full and leaves anything else alone", () => {
    expect(formatReleaseDate("2026-11-22")).toBe("22 November 2026");
    expect(formatReleaseDate("2026-01-05")).toBe("5 January 2026");
    expect(formatReleaseDate("soon")).toBe("soon");
  });

  it("groups by date, then by type in a fixed order, leaving out empty groups", () => {
    const e = (version: string, date: string, type: "new" | "improved" | "fixed" | "retired" | "security") => ({ version, date, title: version, summary: version, body: "", type, pr: "" });
    const days = groupReleases([e("3", "2026-11-22", "fixed"), e("2", "2026-11-22", "new"), e("1.5", "2026-11-22", "fixed"), e("1", "2026-11-21", "improved")]);
    expect(days.map((d) => d.label)).toEqual(["22 November 2026", "21 November 2026"]);
    expect(days[0]?.groups.map((g) => g.label)).toEqual(["New", "Fixed"]);
    expect(days[0]?.groups[1]?.entries.map((x) => x.version)).toEqual(["3", "1.5"]);
    expect(days[1]?.groups.map((g) => g.label)).toEqual(["Improved"]);
  });

  it("compares semantic versions accurately", () => {
    expect(compareVersions("0.114.0", "0.113.0")).toBeGreaterThan(0);
    expect(compareVersions("0.113.1", "0.113.1")).toBe(0);
    expect(compareVersions("0.99.0", "0.100.0")).toBeLessThan(0);
  });

  it("detects when a newer version or newer build commit is deployed", () => {
    expect(hasVersionUpdate({ version: "0.113.0" }, { version: "0.113.0" })).toBe(false);
    expect(hasVersionUpdate({ version: "0.113.0" }, { version: "0.114.0" })).toBe(true);
    expect(hasVersionUpdate({ version: "0.114.0" }, { version: "0.113.0" })).toBe(false);
    expect(hasVersionUpdate({ version: "0.113.0", build: "aaa1111" }, { version: "0.113.0", build: "bbb2222" })).toBe(true);
    expect(hasVersionUpdate({ version: "0.113.0", build: "aaa1111" }, { version: "0.113.0", build: "aaa1111" })).toBe(false);
  });

  it("returns all releases newer than the client tab version", () => {
    const entries = parseReleaseLog(SAMPLE_RELEASES, 5);
    const missed = releasesSince("0.112.0", entries);
    expect(missed.map((r) => r.version)).toEqual(["0.114.0", "0.113.0"]);
  });
});
