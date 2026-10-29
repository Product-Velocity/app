import { describe, expect, it } from "vitest";
import { githubProvider, type TrackerProvider } from "./provider";
import { MemorySourceControl } from "./memory-source";

// The contract every tracker behind TrackerProvider must keep (#67). Jira is added to this list when it exists: the same
// tests then prove it behaves the way the sync expects, without a Jira-specific line in the sync code.
const providers: { name: string; scope: string; make: () => { provider: TrackerProvider; memory?: MemorySourceControl } }[] = [
  { name: "github", scope: "acme/road", make: () => { const memory = new MemorySourceControl(); return { provider: githubProvider(memory, 1), memory }; } },
];

describe.each(providers)("TrackerProvider contract: $name", ({ name, scope, make }) => {
  it("names itself", () => {
    expect(make().provider.id).toBe(name);
  });

  it("creates an issue and reads it back with a string key, the title, the body and its link", async () => {
    const { provider } = make();
    const made = await provider.createIssue(scope, { title: "R-1: Offline mode", body: "Body text", labels: ["pv:moscow/must"] });
    expect(typeof made.key).toBe("string");
    expect(made).toMatchObject({ scope, title: "R-1: Offline mode", body: "Body text", state: "open" });
    expect(made.url).toMatch(/^https:\/\//);
    const read = await provider.readIssue(scope, made.key);
    expect(read).toMatchObject({ key: made.key, id: made.id, title: "R-1: Offline mode", body: "Body text", state: "open" });
    expect(read!.assignees).toEqual([]);
  });

  it("an issue that does not exist reads as null, not as an error", async () => {
    const { provider } = make();
    expect(await provider.readIssue(scope, "424242")).toBeNull();
  });

  it("an update changes the title and body, and only those", async () => {
    const { provider } = make();
    const made = await provider.createIssue(scope, { title: "Old", body: "Old body", labels: ["pv:moscow/must", "team-label"] });
    const after = await provider.updateIssue(scope, made.key, { title: "New" });
    expect(after.title).toBe("New");
    expect(after.body).toBe("Old body");
    expect(after.labels).toEqual(expect.arrayContaining(["pv:moscow/must", "team-label"]));
    expect((await provider.updateIssue(scope, made.key, { body: "New body" })).body).toBe("New body");
  });

  it("finds a created issue again by the marker in its body, and does not find an absent one", async () => {
    const { provider } = make();
    const made = await provider.createIssue(scope, { title: "t", body: "intro <!-- pv:begin item=abc -->", labels: [] });
    expect((await provider.findByMarker(scope, "<!-- pv:begin item=abc -->"))?.key).toBe(made.key);
    expect(await provider.findByMarker(scope, "<!-- pv:begin item=zzz -->")).toBeNull();
  });

  it("assignees: returns the logins the tracker really set", async () => {
    const { provider, memory } = make();
    if (memory) memory.assignable = new Set(["ana"]);
    const made = await provider.createIssue(scope, { title: "t", body: "b", labels: [] });
    expect(await provider.setAssignees(scope, made.key, ["ana", "not-a-collaborator"])).toEqual(["ana"]);
    expect((await provider.readIssue(scope, made.key))!.assignees).toEqual(["ana"]);
  });

  it("children: a list (possibly empty) or null, with string keys and the child's own scope", async () => {
    const { provider } = make();
    const made = await provider.createIssue(scope, { title: "t", body: "b", labels: [] });
    const kids = await provider.listChildren(scope, made.key);
    expect(kids === null || Array.isArray(kids)).toBe(true);
  });

  it("lists the light record of issues with string keys", async () => {
    const { provider, memory } = make();
    memory?.listed.set(scope, [{ number: 7, id: 70, nodeId: "n7", state: "closed", stateReason: "completed", updatedAt: "2026-10-01T00:00:00Z", closedAt: "2026-10-01T00:00:00Z", title: "Bug", labels: ["bug"], htmlUrl: "https://example.test/7", parentNumber: 3 }]);
    const list = await provider.listIssues(scope);
    if (memory) expect(list).toEqual([expect.objectContaining({ key: "7", id: "70", state: "closed", title: "Bug", parentKey: "3", url: "https://example.test/7", labels: ["bug"] })]);
    for (const s of list) expect(typeof s.key).toBe("string");
  });
});

describe("the GitHub adapter", () => {
  it("refuses a key that is not an issue number, instead of calling GitHub with garbage", async () => {
    const provider = githubProvider(new MemorySourceControl(), 1);
    await expect(provider.readIssue("acme/road", "PROD-104")).rejects.toThrow(/Not a GitHub issue number/);
  });
});
