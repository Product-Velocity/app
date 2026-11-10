import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Next.js refuses a build when a "use server" file exports anything but async functions (found on issue #370 phase 4). Types are fine. */
describe('"use server" files export only async functions', () => {
  const root = join(__dirname, "..");
  const files: string[] = [];
  const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) files.push(p); } };
  walk(root);
  const actionFiles = files.filter((f) => /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/.*\n\s*)*["']use server["']/.test(readFileSync(f, "utf8")));
  it("finds the server action files", () => expect(actionFiles.length).toBeGreaterThan(3));
  it.each(actionFiles.map((f) => [f.slice(root.length + 1), f] as const))("%s", (_name, f) => {
    const bad = readFileSync(f, "utf8").split("\n").filter((l) => /^export\s+(const|let|var|class|enum|default|function)\b/.test(l) || /^export\s+\{/.test(l));
    expect(bad).toEqual([]);
  });
});
