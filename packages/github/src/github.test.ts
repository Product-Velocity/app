import { createHmac, createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GitHubAppSourceControl, parseConnectionEvent, permissionGaps, reportMarkdown, runConnectionDiagnostics, signInstallState, verifyInstallState, verifySignature, type SourceControl } from "./index";

const secret = "s3cret";
const state = { tenantId: "t1", userId: "u1", connectionId: "c1", exp: 2_000 };

describe("install state", () => {
  it("round-trips and is bound to the secret", () => {
    const token = signInstallState(state, secret);
    expect(verifyInstallState(token, secret, 1_000)).toEqual(state);
    expect(verifyInstallState(token, "other", 1_000)).toBeNull();
  });
  it("rejects expired, tampered, malformed and empty values", () => {
    const token = signInstallState(state, secret);
    expect(verifyInstallState(token, secret, 2_001)).toBeNull();
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...state, tenantId: "t2" })).toString("base64url");
    expect(verifyInstallState(`${forged}.${sig}`, secret, 1_000)).toBeNull();
    expect(verifyInstallState(`${body}.${sig}.x`, secret, 1_000)).toBeNull();
    expect(verifyInstallState("nope", secret, 1_000)).toBeNull();
    expect(verifyInstallState(null, secret, 1_000)).toBeNull();
  });
});

describe("webhook", () => {
  it("verifies GitHub's signature", () => {
    const sig = `sha256=${createHmac("sha256", secret).update("{}").digest("hex")}`;
    expect(verifySignature("{}", sig, secret)).toBe(true);
    expect(verifySignature("{ }", sig, secret)).toBe(false);
    expect(verifySignature("{}", null, secret)).toBe(false);
  });
  it("reads installation and repository events and ignores everything else", () => {
    const installation = { id: 7, account: { login: "Acme", type: "Organization" }, repository_selection: "selected" };
    expect(parseConnectionEvent("installation", { action: "created", installation })).toEqual({ kind: "installation", action: "created", installationId: 7, accountLogin: "Acme", accountType: "Organization", repositorySelection: "selected" });
    expect(parseConnectionEvent("installation_repositories", { action: "removed", repository_selection: "all", installation })).toMatchObject({ kind: "repositories", action: "removed", repositorySelection: "all" });
    expect(parseConnectionEvent("installation", { action: "weird", installation })).toBeNull();
    expect(parseConnectionEvent("issues", { action: "opened", installation })).toBeNull();
    expect(parseConnectionEvent("installation", { action: "created" })).toBeNull();
  });
});

describe("permissionGaps", () => {
  it("lists only missing or weaker permissions", () => {
    expect(permissionGaps({ issues: "read", metadata: "read" }, { issues: "write", metadata: "read" })).toEqual(["issues (needs write, has read)"]);
  });
});

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

describe("GitHubAppSourceControl", () => {
  it("signs a verifiable RS256 JWT for the App id", () => {
    const sc = new GitHubAppSourceControl({ appId: "123", privateKeyPem: privateKey, now: () => 1_000_000 });
    const [h, b, s] = sc.appJwt().split(".");
    expect(createVerify("RSA-SHA256").update(`${h}.${b}`).verify(publicKey, Buffer.from(s!, "base64url"))).toBe(true);
    expect(JSON.parse(Buffer.from(b!, "base64url").toString())).toMatchObject({ iss: "123", exp: 1_540 });
  });

  it("creates one installation token, reuses it, and never returns it", async () => {
    let tokenCalls = 0;
    const fetchFake = async (url: string) => {
      if (url.endsWith("/access_tokens")) {
        tokenCalls++;
        return new Response(JSON.stringify({ token: "ghs_secret", expires_at: new Date(Date.now() + 3_600_000).toISOString() }), { status: 201 });
      }
      return new Response(JSON.stringify({ repositories: [{ id: 1, full_name: "Acme/a", private: true }] }), { status: 200 });
    };
    const sc = new GitHubAppSourceControl({ appId: "1", privateKeyPem: privateKey, fetch: fetchFake });
    const first = await sc.listRepositories(9);
    await sc.listRepositories(9);
    expect(tokenCalls).toBe(1);
    expect(JSON.stringify(first)).not.toContain("ghs_secret");
    expect(first).toEqual([{ id: 1, fullName: "Acme/a", private: true }]);
  });

  it("treats an unknown installation as null and a denied issue-types read as null", async () => {
    const fetchFake = async (url: string) => (url.includes("/issue-types") ? new Response("{}", { status: 403 }) : url.endsWith("/access_tokens") ? new Response(JSON.stringify({ token: "t" }), { status: 201 }) : new Response("{}", { status: 404 }));
    const sc = new GitHubAppSourceControl({ appId: "1", privateKeyPem: privateKey, fetch: fetchFake });
    expect(await sc.getInstallation(1)).toBeNull();
    expect(await sc.listIssueTypes(1, "Acme")).toBeNull();
  });
});

function fake(over: Partial<SourceControl> = {}): SourceControl {
  return {
    provider: "github",
    getInstallation: async () => ({ id: 1, accountLogin: "Acme", accountType: "Organization", repositorySelection: "selected", permissions: { issues: "write", metadata: "read" }, events: ["issues"], suspended: false }),
    listInstallations: async () => [],
    listRepositories: async () => [{ id: 1, fullName: "Acme/roadmap", private: true }],
    listIssueTypes: async () => ["Task", "Bug"],
    listRecentDeliveries: async () => [{ event: "issues", action: "opened", statusCode: 200, deliveredAt: "2026-10-23T00:00:00Z" }],
    listIssues: async () => [],
    createIssue: async () => { throw new Error("not used"); },
    updateIssue: async () => { throw new Error("not used"); },
    addLabels: async () => undefined,
    getIssue: async () => null,
    findIssueByMarker: async () => null,
    ensureLabels: async () => undefined,
    ...over,
  };
}

describe("runConnectionDiagnostics", () => {
  const input = { installationId: 1, expectedAccount: "acme", projectRepos: [{ project: "Mobile", repo: "Acme/roadmap" }] };
  it("passes a healthy connection and reports later needs as info only", async () => {
    const r = await runConnectionDiagnostics({ sc: fake(), ...input });
    expect(r.filter((x) => x.verdict === "fail")).toEqual([]);
    expect(r.find((x) => x.id === "issue-types")?.summary).toContain("No Epic");
    expect(r.find((x) => x.id === "permissions-later")?.verdict).toBe("info");
  });
  it("stops with a fix when GitHub does not know the installation", async () => {
    const r = await runConnectionDiagnostics({ sc: fake({ getInstallation: async () => null }), ...input });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ verdict: "fail" });
    expect(r[0]!.fix).toBeTruthy();
  });
  it("fails on a missing permission, a wrong account, a lost default repo and rejected webhooks", async () => {
    const sc = fake({
      getInstallation: async () => ({ id: 1, accountLogin: "Other", accountType: "Organization", repositorySelection: "all", permissions: { metadata: "read" }, events: [], suspended: true }),
      listRepositories: async () => [{ id: 2, fullName: "Acme/other", private: false }],
      listRecentDeliveries: async () => [{ event: "issues", action: "opened", statusCode: 401, deliveredAt: "x" }],
    });
    const failed = (await runConnectionDiagnostics({ sc, ...input })).filter((x) => x.verdict === "fail").map((x) => x.id);
    expect(failed).toEqual(["account", "suspended", "permissions", "project-repos", "webhooks"]);
  });
  it("never leaks anything secret-looking into the report", async () => {
    const md = reportMarkdown("t", await runConnectionDiagnostics({ sc: fake(), ...input }));
    expect(md).not.toMatch(/ghs_|BEGIN|private key/i);
  });
});

import { decideConnectionChange, parseIssueEvent, type ConnectionEvent } from "./index";

describe("decideConnectionChange", () => {
  const ev = (over: Record<string, unknown>) => ({ kind: "installation", action: "created", installationId: 5, accountLogin: "Acme", accountType: "Organization", repositorySelection: "selected", ...over }) as ConnectionEvent;
  const bound = { id: "c1", state: "installing" };
  const waiting = { id: "c2", state: "requested" };

  it("a created installation connects the one that was waiting for that account, and only that one", () => {
    expect(decideConnectionChange(ev({}), null, [waiting])).toEqual({ kind: "set", id: "c2", state: "connected", adoptInstallation: true });
    expect(decideConnectionChange(ev({}), null, [])).toEqual({ kind: "ignore" });
    expect(decideConnectionChange(ev({}), null, [waiting, { id: "c3", state: "waiting_approval" }])).toEqual({ kind: "ignore" });
  });
  it("an installation the install-return route already bound is connected without being adopted again", () => {
    expect(decideConnectionChange(ev({}), bound, [waiting])).toEqual({ kind: "set", id: "c1", state: "connected", adoptInstallation: false });
  });
  it("replaying a delivery gives the same decision", () => {
    expect(decideConnectionChange(ev({}), { id: "c1", state: "connected" }, [])).toEqual({ kind: "set", id: "c1", state: "connected", adoptInstallation: false });
    expect(decideConnectionChange(ev({ action: "deleted" }), null, [])).toEqual({ kind: "ignore" });
  });
  it("deleted, suspend and unsuspend act only on the connection that holds the installation", () => {
    expect(decideConnectionChange(ev({ action: "deleted" }), bound, [])).toMatchObject({ state: "disconnected" });
    expect(decideConnectionChange(ev({ action: "suspend" }), bound, [])).toMatchObject({ state: "suspended" });
    expect(decideConnectionChange(ev({ action: "unsuspend" }), bound, [])).toMatchObject({ state: "connected" });
    expect(decideConnectionChange(ev({ action: "suspend" }), null, [waiting])).toEqual({ kind: "ignore" });
  });
  it("repository changes refresh only a connected connection", () => {
    const repos = ev({ kind: "repositories", action: "removed" });
    expect(decideConnectionChange(repos, { id: "c1", state: "connected" }, [])).toEqual({ kind: "refresh", id: "c1" });
    expect(decideConnectionChange(repos, bound, [])).toEqual({ kind: "ignore" });
    expect(decideConnectionChange(repos, null, [waiting])).toEqual({ kind: "ignore" });
  });
});

describe("parseIssueEvent", () => {
  const payload = (over: Record<string, unknown> = {}) => ({ action: "closed", installation: { id: 9 }, repository: { full_name: "Acme/App" }, issue: { number: 31, id: 5, node_id: "I_x", state: "closed", state_reason: "completed", updated_at: "2026-10-23T10:00:00Z", closed_at: "2026-10-23T09:59:00Z", title: "SECRET TITLE", body: "SECRET BODY", user: { login: "someone" } }, ...over });
  it("reads only what the sync needs, never titles, bodies or people", () => {
    const e = parseIssueEvent("issues", payload());
    expect(e).toEqual({ action: "closed", installationId: 9, repo: "Acme/App", number: 31, issueId: 5, nodeId: "I_x", state: "closed", stateReason: "completed", updatedAt: "2026-10-23T10:00:00Z", closedAt: "2026-10-23T09:59:00Z" });
    expect(JSON.stringify(e)).not.toMatch(/SECRET|someone/);
  });
  it("ignores other events, pull requests and malformed payloads", () => {
    expect(parseIssueEvent("pull_request", payload())).toBeNull();
    expect(parseIssueEvent("issues", payload({ issue: { ...payload().issue, pull_request: {} } }))).toBeNull();
    expect(parseIssueEvent("issues", payload({ issue: { ...payload().issue, state: "weird" } }))).toBeNull();
    expect(parseIssueEvent("issues", payload({ issue: { ...payload().issue, updated_at: "not a date" } }))).toBeNull();
    expect(parseIssueEvent("issues", { action: "closed" })).toBeNull();
  });
});
