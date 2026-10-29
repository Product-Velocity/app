import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { refreshIncoming, sinceFor } = await import("./incoming-refresh");
const { MemorySourceControl } = await import("@pv/github");

const issue = (number: number, updatedAt: string) => ({ number, id: number * 10, nodeId: `n${number}`, state: "open" as const, stateReason: null, updatedAt, closedAt: null, title: `Issue ${number}`, issueType: null, labels: [], htmlUrl: `https://github.com/Acme/App/issues/${number}`, parentNumber: null, assignees: [] });

/** The admin client, reduced to what the refresh uses: the repositories of the connection, and the rpc that records issues. */
function fakeAdmin(repos: string[], rpcFailsFor: string | null = null) {
  const rpcs: { name: string; repo: string; count: number }[] = [];
  const client = {
    rpcs,
    from: () => ({ select: () => ({ eq: () => ({ is: async () => ({ data: repos.map((full_name) => ({ full_name })), error: null }) }) }) }),
    rpc: async (name: string, args: { p_rows: { repo: string }[] }) => {
      const repo = args.p_rows[0]?.repo ?? "";
      if (rpcFailsFor && repo === rpcFailsFor) return { data: null, error: { message: "boom" } };
      rpcs.push({ name, repo, count: args.p_rows.length });
      return { data: args.p_rows.length, error: null };
    },
  };
  return client as unknown as Parameters<typeof refreshIncoming>[0] & { rpcs: typeof rpcs };
}
const connection = { id: "c1", tenant_id: "t1", expected_account: "Acme", installation_id: 7, account_login: "Acme", state: "connected" as const };

describe("sinceFor: how far back the light check reads", () => {
  const NOW = Date.parse("2026-10-29T12:00:00Z");
  it("starts an hour before the last full check, so nothing in flight is missed", () => {
    expect(sinceFor("2026-10-29T06:00:00Z", NOW)).toBe("2026-10-29T05:00:00.000Z");
  });
  it("without a last check, or with one that cannot be read, it looks back a week", () => {
    expect(sinceFor(null, NOW)).toBe("2026-10-22T12:00:00.000Z");
    expect(sinceFor("not a date", NOW)).toBe("2026-10-22T12:00:00.000Z");
  });
  it("never looks back further than 30 days, however old the last check", () => {
    expect(sinceFor("2026-01-01T00:00:00Z", NOW)).toBe("2026-09-29T12:00:00.000Z");
  });
  it("never looks into the future", () => {
    expect(sinceFor("2026-10-30T00:00:00Z", NOW)).toBe("2026-10-29T12:00:00.000Z");
  });
});

describe("refreshIncoming: reading what is new in every repository, lightly", () => {
  it("asks each repository only for what changed since, at most a few pages, and records it", async () => {
    const sc = new MemorySourceControl();
    sc.listed.set("Acme/App", [issue(1, "2026-10-29T10:00:00Z"), issue(2, "2026-10-20T10:00:00Z")]);
    sc.listed.set("Acme/Notes", [issue(3, "2026-10-29T11:00:00Z")]);
    const admin = fakeAdmin(["Acme/App", "Acme/Notes"]);
    const r = await refreshIncoming(admin, sc, connection, "2026-10-28T00:00:00.000Z");
    expect(r).toEqual({ repos: 2, read: 2, failed: 0 }); // issue 2 is older than the time asked for
    expect(sc.lastListOptions).toEqual({ since: "2026-10-28T00:00:00.000Z", maxPages: 3 });
    expect(admin.rpcs.map((x) => [x.repo, x.count]).sort()).toEqual([["Acme/App", 1], ["Acme/Notes", 1]]);
    expect(admin.rpcs.every((x) => x.name === "tracker_upsert_issues")).toBe(true);
  });

  it("a quiet repository records nothing and costs one read", async () => {
    const sc = new MemorySourceControl();
    const admin = fakeAdmin(["Acme/App"]);
    expect(await refreshIncoming(admin, sc, connection, "2026-10-28T00:00:00.000Z")).toEqual({ repos: 1, read: 0, failed: 0 });
    expect(admin.rpcs).toEqual([]);
    expect(sc.calls.filter((c) => c === "listIssues")).toHaveLength(1);
  });

  it("one repository failing does not stop the others, and is counted", async () => {
    const sc = new MemorySourceControl();
    sc.listed.set("Acme/App", [issue(1, "2026-10-29T10:00:00Z")]);
    sc.listed.set("Acme/Notes", [issue(3, "2026-10-29T11:00:00Z")]);
    const admin = fakeAdmin(["Acme/App", "Acme/Notes"], "Acme/App");
    expect(await refreshIncoming(admin, sc, connection, "2026-10-28T00:00:00.000Z")).toEqual({ repos: 2, read: 1, failed: 1 });
    expect(admin.rpcs.map((x) => x.repo)).toEqual(["Acme/Notes"]);
  });

  it("a connection without an installation reads nothing", async () => {
    const sc = new MemorySourceControl();
    expect(await refreshIncoming(fakeAdmin(["Acme/App"]), sc, { ...connection, installation_id: null }, "2026-10-28T00:00:00.000Z")).toEqual({ repos: 0, read: 0, failed: 0 });
    expect(sc.calls).toEqual([]);
  });
});
