import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// CLAUDE.md rule 6 + the exception in docs/decisions/2026-11-03-jira-close-removed.md: the only place that may move a Jira issue to another
// status is jira-close.ts, and only jira-removed-engine.ts (the confirmed, per-initiative close of an issue Product Velocity owns, after the
// initiative was deleted) may use it. Everything else that talks to Jira stays free of transitions, status writes and deletes. This test reads
// the source and fails when another code path gains one; the payload test (outbound-allowlist.test.ts) separately says create/update payloads
// carry no status.
const SRC = join(__dirname, "..", "..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" ? [] : files(p);
    return /\.(ts|tsx|mjs|js)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}
const SOURCES = files(SRC).map((p) => ({ path: relative(SRC, p).replaceAll("\\", "/"), text: readFileSync(p, "utf8") }));
const withText = (re: RegExp) => SOURCES.filter((s) => re.test(s.text)).map((s) => s.path).sort();

describe("no other code path can transition or delete a Jira issue", () => {
  it("only jira-close.ts builds a transitions request", () => {
    expect(withText(/\/transitions/)).toEqual(["lib/atlassian/jira-close.ts"]);
    expect(withText(/\{\s*transition\s*:\s*\{/)).toEqual(["lib/atlassian/jira-close.ts"]);
  });
  it("only the removed-initiatives engine imports jira-close", () => {
    expect(withText(/from\s+["'](\.\/|@\/lib\/atlassian\/)jira-close["']/)).toEqual(["lib/atlassian/jira-removed-engine.ts"]);
  });
  it("only the server action file imports that engine (and the engine's own test does not count)", () => {
    expect(withText(/jira-removed-engine["']/)).toEqual(["app/(workspace)/portfolio/jira-removed.ts"]);
  });
  it("the write client has no transition, no DELETE and no way to write a status", () => {
    const w = SOURCES.find((s) => s.path === "lib/atlassian/jira-write.ts")!.text;
    expect(w).not.toMatch(/"DELETE"/);
    expect(w).not.toMatch(/\bPOST\b[^\n]*transitions/);
  });
  it("the Jira request type has no DELETE, so no code can send one", () => {
    const w = SOURCES.find((s) => s.path === "lib/atlassian/jira-write.ts")!.text;
    expect(w).toMatch(/method: "GET" \| "POST" \| "PUT"/);
    for (const s of SOURCES.filter((x) => (x.path.startsWith("lib/atlassian/") || x.path.startsWith("app/(workspace)/portfolio/jira")))) expect(s.text, s.path).not.toMatch(/["']DELETE["']/);
  });
  it("no Jira payload builder, outside jira-close.ts, writes a status or a resolution", () => {
    const builders = SOURCES.filter((s) => s.path.startsWith("lib/atlassian/") && s.path !== "lib/atlassian/jira-close.ts");
    for (const s of builders) expect(s.text, s.path).not.toMatch(/fields\s*:\s*\{[^}]*\b(status|resolution)\b/);
  });
});
