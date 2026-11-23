import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP = join(__dirname, "..", "app");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((e) => (statSync(join(dir, e)).isDirectory() ? walk(join(dir, e)).map((p) => `${e}/${p}`) : [e]));

/**
 * Security review 2026-11-23: the throwaway spike console at /spikes/github let any workspace admin call the GitHub API as the App
 * (a `..` in the path got past its allowlist and could mint installation tokens for other customers). Spikes never ship as routes again.
 */
describe("no throwaway routes", () => {
  const files = walk(APP);
  it("has no spikes pages or routes", () => {
    expect(files.filter((f) => /(^|\/)spikes(\/|$)/i.test(f))).toEqual([]);
  });
  it("has no route that signs a request with the GitHub App key outside lib/github", () => {
    expect(files.filter((f) => /\bapp-jwt\b|github-app/i.test(f))).toEqual([]);
  });
});
