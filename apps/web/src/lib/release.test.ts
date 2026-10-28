import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM module without types
import { assemble, FRAGMENT_DIR, nextVersion, parseFragment } from "../../../../tools/release/assemble.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const TABLE = "# Release log\n\nintro\n\n| Version | Date | Key updates | PRs |\n|---|---|---|---|\n| 0.5.0 | 2026-10-01 | **Old.** An older release. | #1 |\n";
const frag = (bump: string, body = "**A feature.** It does something people can see.") => `---\nbump: ${bump}\n---\n${body}\n`;

describe("release fragments (issue #238)", () => {
  it("every fragment in the repo is valid, so a bad one never blocks the release workflow", () => {
    const names = readdirSync(FRAGMENT_DIR).filter((f: string) => f.endsWith(".md") && f.toLowerCase() !== "readme.md");
    for (const n of names) expect(() => parseFragment(n, readFileSync(path.join(FRAGMENT_DIR, n), "utf8")), n).not.toThrow();
  });

  it("reads the bump and turns the text into one table cell", () => {
    const f = parseFragment("a.md", frag("minor", "**Title.** Line one\n\nline two | with a pipe"));
    expect(f).toEqual({ name: "a.md", bump: "minor", body: "**Title.** Line one line two \\| with a pipe" });
  });

  it("refuses a missing header, a bad bump, no text, and text that already carries a version", () => {
    expect(() => parseFragment("a.md", "just text")).toThrow(/header/);
    expect(() => parseFragment("a.md", frag("major"))).toThrow(/minor or patch/);
    expect(() => parseFragment("a.md", frag("patch", "short"))).toThrow(/what changed/);
    expect(() => parseFragment("a.md", frag("patch", "| 0.9.0 | 2026-10-28 | **x** a sentence long enough | |"))).toThrow(/version and date are added/);
  });

  it("computes the next version", () => {
    expect(nextVersion("0.51.3", "minor")).toBe("0.52.0");
    expect(nextVersion("0.51.3", "patch")).toBe("0.51.4");
    expect(() => nextVersion("x", "minor")).toThrow();
  });

  it("gives each fragment the next version in file-name order and puts the newest row on top", () => {
    const out = assemble({
      version: "0.5.0", releases: TABLE, date: "2026-10-28", pr: "#9",
      fragments: [{ name: "20261028-b.md", bump: "patch", body: "**Fix.** B." }, { name: "20261027-a.md", bump: "minor", body: "**Feature.** A." }],
    });
    expect(out.version).toBe("0.6.1");
    expect(out.applied).toEqual([{ version: "0.6.0", name: "20261027-a.md" }, { version: "0.6.1", name: "20261028-b.md" }]);
    const rows = out.releases.split("\n").filter((l: string) => /^\| \d/.test(l));
    expect(rows.map((r: string) => r.split("|")[1]!.trim())).toEqual(["0.6.1", "0.6.0", "0.5.0"]);
    expect(rows[0]).toBe("| 0.6.1 | 2026-10-28 | **Fix.** B. | #9 |");
    expect(out.releases.startsWith("# Release log")).toBe(true);
  });

  it("the real log still has its table, so the script has somewhere to write", () => {
    const log = readFileSync(path.join(root, "docs/RELEASES.md"), "utf8");
    expect(() => assemble({ version: "0.1.0", releases: log, fragments: [], date: "2026-10-28" })).not.toThrow();
  });
});
