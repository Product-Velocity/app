import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// R-113 / rule 2: the full PRD and other documents stay in Product Velocity. No code that builds or reads a GitHub payload may touch them.
const roots = [join(__dirname), join(__dirname, "../../../../../packages/github/src")];
const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });

describe("documents are never part of a GitHub payload", () => {
  it("no GitHub source file reads item_documents or its versions", () => {
    const files = roots.flatMap(sources);
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/item_documents|item_document_versions/);
  });
  it("no GitHub source file reads the assistant memory or the company profile (rule 2, docs/27)", () => {
    for (const f of roots.flatMap(sources)) expect(readFileSync(f, "utf8"), f).not.toMatch(/ai_memories|company_profiles|company_profile_versions/);
  });
});
