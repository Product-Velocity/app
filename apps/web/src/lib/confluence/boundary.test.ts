import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// CLAUDE.md rule 2 and the decisions 2026-10-29 / 2026-11-26: the text of a document goes to Confluence (the customer's own private site) only through the
// publish flow, after a preview a person confirms. It must never reach a GitHub or Jira payload, so no tracker source imports the Confluence code, and the
// Confluence code never reads the tracker payload builders. The pure parts also never touch the database.
const lib = join(__dirname, "..");
const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });

describe("the Confluence publish code stays apart from the tracker payloads", () => {
  it("no GitHub or Jira source file imports it", () => {
    const tracker = [...sources(join(lib, "github")), ...sources(join(lib, "../../../../packages/github/src")), ...sources(join(lib, "atlassian"))];
    expect(tracker.length).toBeGreaterThan(20);
    for (const f of tracker) expect(readFileSync(f, "utf8"), f).not.toMatch(/lib\/confluence|from "\.\.\/confluence|@pv\/domain\/confluence/);
  });

  it("the Confluence code does not import the GitHub or Jira payload builders", () => {
    for (const f of sources(join(lib, "confluence"))) expect(readFileSync(f, "utf8"), f).not.toMatch(/lib\/github|buildJiraPayload|OUTBOUND_JIRA_FIELDS|@pv\/github/);
  });

  it("the client and the publish flow are pure: no database, no service role, no token", () => {
    for (const f of ["client.ts", "publish.ts"]) {
      const text = readFileSync(join(lib, "confluence", f), "utf8");
      expect(text, f).not.toMatch(/supabase|createAdminClient|accessTokenFor|process\.env|item_documents|jira_credentials/);
    }
  });

  it("the client has no way to delete a page or to touch permissions", () => {
    const text = readFileSync(join(lib, "confluence", "client.ts"), "utf8");
    expect(text).not.toMatch(/"DELETE"/);
    expect(text).not.toMatch(/\/restriction|\/permission/);
  });
});
