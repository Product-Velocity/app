import { describe, expect, it } from "vitest";
import {
  compareVersions,
  hasVersionUpdate,
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
      pr: "#370",
    });
    expect(entries[1]?.version).toBe("0.113.0");
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
