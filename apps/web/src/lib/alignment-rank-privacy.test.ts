import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Issue #397 (rule 2): the reasons an admin gives for a rank that differs from the vote can hold commercial context. They must never reach a
// tracker payload. Nothing that talks to GitHub, Jira or Confluence, or builds what they receive, may read these tables or functions.
const ROOT = join(__dirname, "..", "..", "..", "..");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? (n === "node_modules" || n === ".next" ? [] : walk(p)) : /\.(ts|tsx|mjs|sql)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
});
const FORBIDDEN = /alignment_rank_(reasons|applications)|item_alignment_decisions|alignment_rank_apply|RankDecision/;

describe("rank reasons stay out of tracker payloads", () => {
  for (const dir of ["apps/web/src/lib/github", "apps/web/src/lib/atlassian", "apps/web/src/app/api/github", "apps/web/src/app/api/jira", "apps/web/src/app/api/atlassian", "packages/github/src"]) {
    it(`${dir} never reads them`, () => {
      const files = walk(join(ROOT, dir));
      expect(files.length, dir).toBeGreaterThan(0);
      const hits = files.filter((f) => FORBIDDEN.test(readFileSync(f, "utf8"))).map((f) => f.replace(ROOT, ""));
      expect(hits).toEqual([]);
    });
  }
});
