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

describe("GitHubAppSourceControl: Projects (boards) over GraphQL", () => {
  const graphqlFake = (reply: (query: string, variables: Record<string, unknown>) => unknown, seen: { query: string; variables: Record<string, unknown> }[] = []) =>
    async (url: string, init?: RequestInit) => {
      if (url.endsWith("/access_tokens")) return new Response(JSON.stringify({ token: "t" }), { status: 201 });
      if (url.endsWith("/graphql")) {
        const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
        seen.push(body);
        return new Response(JSON.stringify(reply(body.query, body.variables)), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    };
  const make = (f: (url: string, init?: RequestInit) => Promise<Response>) => new GitHubAppSourceControl({ appId: "1", privateKeyPem: privateKey, fetch: f as typeof fetch });

  it("lists boards, reads fields with their single-select options, adds an issue and writes values", async () => {
    const seen: { query: string; variables: Record<string, unknown> }[] = [];
    const sc = make(graphqlFake((q) => {
      if (q.includes("projectsV2")) return { data: { organization: { projectsV2: { nodes: [{ id: "PVT_1", number: 3, title: "Roadmap", url: "https://github.com/orgs/Acme/projects/3", closed: false }] } } } };
      if (q.includes("fields(first")) return { data: { node: { fields: { nodes: [{ id: "F1", name: "Priority", dataType: "SINGLE_SELECT", options: [{ id: "O1", name: "P0" }] }, { id: "F2", name: "Due date", dataType: "DATE" }, { id: "F3", name: "Iteration", dataType: "ITERATION" }, {}] } } } };
      if (q.includes("addProjectV2ItemById")) return { data: { addProjectV2ItemById: { item: { id: "PVTI_9" } } } };
      return { data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_9" } } } };
    }, seen));
    expect(await sc.listBoards(1, "Acme")).toEqual([{ id: "PVT_1", number: 3, title: "Roadmap", url: "https://github.com/orgs/Acme/projects/3", closed: false }]);
    expect(await sc.getBoardFields(1, "PVT_1")).toEqual([
      { id: "F1", name: "Priority", dataType: "SINGLE_SELECT", options: [{ id: "O1", name: "P0" }] }, { id: "F2", name: "Due date", dataType: "DATE" }, { id: "F3", name: "Iteration", dataType: "OTHER" },
    ]);
    expect(await sc.addBoardItem(1, "PVT_1", "I_node")).toBe("PVTI_9");
    await sc.setBoardValue(1, "PVT_1", "PVTI_9", "F1", { optionId: "O1" });
    await sc.setBoardValue(1, "PVT_1", "PVTI_9", "F2", { date: "2026-12-15" });
    expect(seen.at(-2)!.variables.v).toEqual({ singleSelectOptionId: "O1" });
    expect(seen.at(-1)!.variables.v).toEqual({ date: "2026-12-15" });
  });
  it("reads the issues of a board with their status, page by page, and skips drafts and pull requests", async () => {
    const seen: { variables: Record<string, unknown> }[] = [];
    let page = 0;
    const sc = make(graphqlFake((_q, v) => {
      seen.push({ variables: v });
      page++;
      return page === 1
        ? { data: { node: { items: { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [
            { id: "PVTI_1", content: { id: "I_1", number: 175, repository: { nameWithOwner: "Acme/App" } }, fieldValueByName: { name: "Ready" } },
            { id: "PVTI_2", content: {}, fieldValueByName: null }, // a draft
            { id: "PVTI_3", content: { id: "PR_1", number: 7 }, fieldValueByName: null }, // a pull request (no repository asked)
          ] } } } }
        : { data: { node: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: "PVTI_4", content: { id: "I_4", number: 176, repository: { nameWithOwner: "Acme/App" } }, fieldValueByName: null }] } } } };
    }));
    expect(await sc.listBoardItems(1, "PVT_1", "Status")).toEqual([
      { itemId: "PVTI_1", issueNodeId: "I_1", repo: "Acme/App", number: 175, status: "Ready" },
      { itemId: "PVTI_4", issueNodeId: "I_4", repo: "Acme/App", number: 176, status: null },
    ]);
    expect(seen.map((s) => s.variables.after)).toEqual([null, "c1"]);
    expect(seen[0]!.variables.n).toBe("Status");
  });
  it("a GraphQL error carries GitHub's own message (type and text) as the detail of a 422", async () => {
    const sc = make(graphqlFake(() => ({ errors: [{ type: "UNPROCESSABLE", message: "Field value is invalid for ghs_SECRET123" }] })));
    const e = await sc.addBoardItem(1, "PVT_1", "I_x").catch((x) => x);
    expect(e).toMatchObject({ status: 422, detail: "UNPROCESSABLE: Field value is invalid for [token]" });
  });
  it("reads the values of a board item by field id: option names, dates and texts", async () => {
    const sc = make(graphqlFake(() => ({ data: { node: { fieldValues: { nodes: [{ name: "P0", field: { id: "F1" } }, { date: "2026-12-31", field: { id: "F2" } }, { text: "Mobile", field: { id: "F3" } }, {}, null, { name: "No field" }] } } } })));
    expect(await sc.getBoardItemValues(1, "PVTI_1")).toEqual({ F1: { option: "P0" }, F2: { date: "2026-12-31" }, F3: { text: "Mobile" } });
    expect(await make(graphqlFake(() => ({ data: { node: null } }))).getBoardItemValues(1, "PVTI_x")).toBeNull();
  });
  it("a Project the App cannot see is null, and a missing permission is a 403 with a plain message", async () => {
    expect(await make(graphqlFake(() => ({ data: { node: null } }))).getBoardFields(1, "PVT_x")).toBeNull();
    const denied = make(graphqlFake(() => ({ errors: [{ type: "FORBIDDEN", message: "Resource not accessible by integration" }] })));
    await expect(denied.listBoards(1, "Acme")).rejects.toMatchObject({ status: 403, message: expect.stringContaining("Organization Projects permission") });
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
    listSubIssues: async () => [],
    createIssue: async () => { throw new Error("not used"); },
    updateIssue: async () => { throw new Error("not used"); },
    addLabels: async () => undefined,
    removeLabel: async () => undefined,
    ensureMilestone: async () => 1,
    listBoards: async () => [],
    getBoardFields: async () => null,
    getBoardItemValues: async () => null,
    listBoardItems: async () => [],
    addBoardItem: async () => "PVTI_1",
    setBoardValue: async () => undefined,
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
  it("tells whether live updates for issues and sub-issues are on, and how to switch them on", async () => {
    const inst = (events: string[]) => async () => ({ id: 1, accountLogin: "Acme", accountType: "Organization" as const, repositorySelection: "selected" as const, permissions: { issues: "write", metadata: "read" }, events, suspended: false });
    const off = (await runConnectionDiagnostics({ sc: fake({ getInstallation: inst(["issues"]) }), ...input })).find((x) => x.id === "live-updates")!;
    expect(off).toMatchObject({ verdict: "info" });
    expect(off.summary).toContain("sub_issues");
    expect(off.fix).toContain("Sub-issues");
    const on = (await runConnectionDiagnostics({ sc: fake({ getInstallation: inst(["issues", "sub_issues"]) }), ...input })).find((x) => x.id === "live-updates")!;
    expect(on.verdict).toBe("pass");
  });
  it("says whether board status arrives in real time", async () => {
    const inst = (events: string[]) => async () => ({ id: 1, accountLogin: "Acme", accountType: "Organization" as const, repositorySelection: "selected" as const, permissions: { issues: "write", metadata: "read" }, events, suspended: false });
    expect((await runConnectionDiagnostics({ sc: fake({ getInstallation: inst(["issues"]) }), ...input })).find((x) => x.id === "board-status-live")).toMatchObject({ verdict: "info" });
    expect((await runConnectionDiagnostics({ sc: fake({ getInstallation: inst(["issues", "projects_v2_item"]) }), ...input })).find((x) => x.id === "board-status-live")!.verdict).toBe("pass");
  });
  it("says whether projects can be linked to a board, and how to allow it", async () => {
    const inst = (permissions: Record<string, string>) => async () => ({ id: 1, accountLogin: "Acme", accountType: "Organization" as const, repositorySelection: "selected" as const, permissions, events: ["issues"], suspended: false });
    const off = (await runConnectionDiagnostics({ sc: fake({ getInstallation: inst({ issues: "write", metadata: "read" }) }), ...input })).find((x) => x.id === "boards")!;
    expect(off).toMatchObject({ verdict: "info" });
    expect(off.fix).toContain("Projects");
    const on = (await runConnectionDiagnostics({ sc: fake({ getInstallation: inst({ issues: "write", metadata: "read", organization_projects: "write" }) }), ...input })).find((x) => x.id === "boards")!;
    expect(on.verdict).toBe("pass");
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
  const payload = (over: Record<string, unknown> = {}) => ({ action: "closed", installation: { id: 9 }, repository: { full_name: "Acme/App" }, issue: { number: 31, id: 5, node_id: "I_x", state: "closed", state_reason: "completed", updated_at: "2026-10-23T10:00:00Z", closed_at: "2026-10-23T09:59:00Z", title: "A title", html_url: "https://github.com/Acme/App/issues/31", type: { name: "Bug" }, labels: [{ name: "support" }], body: "SECRET BODY", user: { login: "someone" } }, ...over });
  it("reads the light record (title, type, labels, link) and never bodies or people", () => {
    const e = parseIssueEvent("issues", payload());
    expect(e).toEqual({ action: "closed", installationId: 9, repo: "Acme/App", number: 31, issueId: 5, nodeId: "I_x", state: "closed", stateReason: "completed", updatedAt: "2026-10-23T10:00:00Z", closedAt: "2026-10-23T09:59:00Z", title: "A title", issueType: "Bug", labels: ["support"], htmlUrl: "https://github.com/Acme/App/issues/31", parentNumber: null });
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
