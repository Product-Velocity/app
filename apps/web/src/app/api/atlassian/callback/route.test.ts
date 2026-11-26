import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signConnectState } from "@/lib/atlassian/connect-state";

// One return address serves both Atlassian sign-ins; the signed state says which connection it is for (issue #693): Confluence has its own.
const key = randomBytes(32);
const calls: string[] = [];
vi.mock("@/lib/atlassian/token-crypto", () => ({ keyRing: () => ({ current: key }) }));
vi.mock("@/lib/atlassian/connect", () => ({ completeConnection: async () => { calls.push("jira"); return "/settings/integrations/jira?status=connected"; } }));
vi.mock("@/lib/confluence/connect", () => ({ completeConfluenceConnection: async () => { calls.push("confluence"); return "/settings/integrations/confluence?status=connected"; } }));

import { GET } from "./route";
import type { NextRequest } from "next/server";

const get = (state: string | null) => GET(new Request(`https://app.example.test/api/atlassian/callback?code=abc${state ? `&state=${encodeURIComponent(state)}` : ""}`) as unknown as NextRequest);

beforeEach(() => { calls.length = 0; });

describe("the Atlassian return address", () => {
  it("a Confluence state completes the Confluence connection and goes to its page", async () => {
    const r = await get(signConnectState("t", "u", key, Date.now(), "confluence"));
    expect(calls).toEqual(["confluence"]);
    expect(new URL(r.headers.get("location")!).pathname).toBe("/settings/integrations/confluence");
  });
  it("a Jira state (no kind) completes the Jira connection and goes to its page, exactly as before", async () => {
    const r = await get(signConnectState("t", "u", key));
    expect(calls).toEqual(["jira"]);
    expect(new URL(r.headers.get("location")!).pathname).toBe("/settings/integrations/jira");
  });
  it("anything else goes back to the Jira page as a bad link and completes nothing", async () => {
    const r = await get("not-a-state");
    expect(calls).toEqual([]);
    expect(r.headers.get("location")).toContain("/settings/integrations/jira?status=bad-link");
    const none = await get(null);
    expect(none.headers.get("location")).toContain("status=bad-link");
  });
  it("a Confluence state that was tampered with is not treated as a Confluence state", async () => {
    const [v, , sig] = signConnectState("t", "u", key, Date.now(), "confluence").split(".");
    const forged = Buffer.from(JSON.stringify({ t: "other", u: "u", exp: 9_999_999_999, n: "x", k: "confluence" })).toString("base64url");
    await get(`${v}.${forged}.${sig}`);
    expect(calls).toEqual(["jira"]); // falls through to the Jira completion, which verifies the state itself and refuses it
  });
});
