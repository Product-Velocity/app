import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// CLAUDE.md rule 6 + the exception in docs/decisions/2026-11-03-github-close-removed.md: the only place that may close a GitHub issue is
// lib/github/github-close.ts, and only github-removed-engine.ts (the confirmed, per-initiative close of an issue Product Velocity owns, after the
// initiative was deleted) may use it. Everything else that talks to GitHub stays free of closing, reopening, status writes and issue deletes. This test
// reads the source and fails when another code path gains one (the twin of lib/atlassian/transition-guard.test.ts).
const WEB = join(__dirname, "..", "..");
const PKG = join(__dirname, "..", "..", "..", "..", "..", "packages", "github", "src");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" ? [] : files(p);
    return /\.(ts|tsx|mjs|js)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}
const read = (root: string) => files(root).map((p) => ({ path: relative(root, p).replaceAll("\\", "/"), text: readFileSync(p, "utf8") }));
const APP = read(WEB);
const LIB = read(PKG);
const withText = (set: { path: string; text: string }[], re: RegExp) => set.filter((s) => re.test(s.text)).map((s) => s.path).sort();

describe("no other code path can close, reopen or delete a GitHub issue", () => {
  it("only github-close.ts calls the close method in the app", () => {
    expect(withText(APP, /\.closeIssueNotPlanned\s*\(/)).toEqual(["lib/github/github-close.ts"]);
  });
  it("only the removed-initiatives engine imports github-close", () => {
    expect(withText(APP, /from\s+["'](\.\/|@\/lib\/github\/)github-close["']/)).toEqual(["lib/github/github-removed-engine.ts"]);
  });
  it("only the server action file imports that engine", () => {
    expect(withText(APP, /github-removed-engine["']/)).toEqual(["app/(workspace)/portfolio/github-removed.ts"]);
  });
  it("in the GitHub package, the close payload exists in one place only: the App client's closeIssueNotPlanned (and the in-memory fake)", () => {
    expect(withText(LIB, /state_reason\s*:\s*["']/)).toEqual(["github-app.ts", "memory-source.ts"]);
    expect(withText(LIB, /state\s*:\s*["']closed["']/)).toEqual(["github-app.ts", "memory-source.ts"]);
    const app = LIB.find((s) => s.path === "github-app.ts")!.text;
    expect(app.match(/state_reason\s*:\s*["'](\w+)["']/g)).toEqual(['state_reason: "not_planned"']); // never "completed", never "reopened"
    expect(app).not.toMatch(/state\s*:\s*["']open["']/);
  });
  it("the update and the assignee writes cannot carry a state: their inputs have no such field", () => {
    const sc = LIB.find((s) => s.path === "source-control.ts")!.text;
    const update = /updateIssue\([^)]*input: \{([^}]*)\}/.exec(sc)![1]!;
    expect(update).not.toMatch(/state/);
    expect(sc).not.toMatch(/reopen\w*\s*\(/i); // no method that reopens
  });
  it("the only DELETE the GitHub client sends removes a label", () => {
    const app = LIB.find((s) => s.path === "github-app.ts")!.text;
    const deletes = app.match(/"DELETE"[^\n]*/g) ?? [];
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toMatch(/\/labels\//);
    for (const s of APP.filter((x) => x.path.startsWith("lib/github/") || x.path.startsWith("app/(workspace)/portfolio/github"))) expect(s.text, s.path).not.toMatch(/["']DELETE["']/);
  });
  it("no GitHub payload builder writes a state or a state_reason (create and update payloads carry no status)", () => {
    for (const s of LIB.filter((x) => ["outbound.ts", "push.ts", "board.ts", "assignees.ts"].includes(x.path))) expect(s.text, s.path).not.toMatch(/state_reason|state\s*:\s*["'](closed|open)["']/);
  });
});
