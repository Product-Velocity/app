import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// CLAUDE.md rule 2 as changed on 2026-11-05 (Ashu, issue #325): written documents ARE shared with the GitHub issue and the Jira description, unless the
// person chose "Do not share". What stays true is WHERE: only the two readers below may touch item_documents, each must ask for shared documents
// only, and the GitHub package (the payload builder) never reads the table: it only receives text that was already rendered and cut.
const githubDir = join(__dirname);
const githubPkg = join(__dirname, "../../../../../packages/github/src");
const atlassianDir = join(__dirname, "../atlassian");
const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
const READERS = ["push.ts", "jira-sync-engine.ts"];

describe("documents reach a delivery platform only through the shared-documents readers", () => {
  it("no other GitHub or Jira source file reads item_documents or its versions", () => {
    const files = [...sources(githubDir), ...sources(githubPkg), ...sources(atlassianDir)];
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      if (READERS.some((r) => f.endsWith(`/${r}`))) continue;
      expect(readFileSync(f, "utf8"), f).not.toMatch(/item_documents|item_document_versions/);
    }
  });
  it("the two readers ask only for documents left shared, and never read the versions", () => {
    for (const r of READERS) {
      const file = [...sources(githubDir), ...sources(atlassianDir)].find((f) => f.endsWith(`/${r}`))!;
      const text = readFileSync(file, "utf8");
      const reads = text.match(/from\("item_documents"\)[^;]*/g) ?? [];
      expect(reads.length, r).toBeGreaterThan(0);
      for (const q of reads) expect(q, `${r}: ${q}`).toContain('.eq("shared", true)');
      expect(text, r).not.toMatch(/item_document_versions/);
    }
  });
});
