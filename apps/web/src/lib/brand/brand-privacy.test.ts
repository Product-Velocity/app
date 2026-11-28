import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Issue #750 (rule 2): the company brand and its files are never read by anything that builds a GitHub, Jira or Confluence payload.
const ROOT = join(__dirname, "..", "..", "..", "..", "..");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? (n === "node_modules" || n === ".next" ? [] : walk(p)) : /\.(ts|tsx|mjs|sql)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
});
const FORBIDDEN = /workspace_brand|lib\/brand\/|public_token/;

describe("the company brand stays out of tracker payloads", () => {
  for (const dir of ["apps/web/src/lib/github", "apps/web/src/lib/atlassian", "apps/web/src/app/api/github", "apps/web/src/app/api/jira", "apps/web/src/app/api/atlassian", "packages/github/src"]) {
    it(`${dir} never reads it`, () => {
      const files = walk(join(ROOT, dir));
      expect(files.length, dir).toBeGreaterThan(0);
      expect(files.filter((f) => FORBIDDEN.test(readFileSync(f, "utf8"))).map((f) => f.replace(ROOT, ""))).toEqual([]);
    });
  }
});
