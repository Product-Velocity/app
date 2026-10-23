import { describe, expect, it } from "vitest";
import { planAction, BLOCK_END, BLOCK_START, buildTrackingIssue, describePushError, GitHubError, MemorySourceControl, mergeBody, OUTBOUND_ITEM_FIELDS, outsideBlock, projectLabel, pushTrackingIssue, sanitize } from "./index";

const ID = "11111111-1111-4111-8111-111111111111";
const base = { item: { item_code: "R-12", initiative_name: "Faster checkout", summary: "Cut steps.", hypothesis: "IF we cut steps THEN conversion rises" }, itemId: ID, projectName: "Mobile App", appUrl: "https://productvelocity.app", artifacts: [{ label: "PRD", url: "https://example.test/prd" }] };

describe("buildTrackingIssue", () => {
  it("builds the title, the managed block, labels and a stable hash", () => {
    const a = buildTrackingIssue(base);
    expect(a.title).toBe("R-12: Faster checkout");
    expect(a.labels).toEqual(["product-velocity", "pv:project/mobile-app"]);
    expect(a.block.startsWith(`<!-- pv:begin item=${ID} -->`)).toBe(true);
    expect(a.block.endsWith(BLOCK_END)).toBe(true);
    expect(a.block).toContain("- [PRD](https://example.test/prd)");
    expect(a.block).toContain("https://productvelocity.app/portfolio/R-12)"); // the item page is addressed by its code, not its id
    expect(a.block).not.toContain(`/portfolio/${ID}`);
    expect(buildTrackingIssue(base).hash).toBe(a.hash);
    expect(buildTrackingIssue({ ...base, item: { ...base.item, summary: "Changed" } }).hash).not.toBe(a.hash);
  });
  it("reads only the allowlisted fields of the item", () => {
    const read: string[] = [];
    const item = new Proxy({ ...base.item, value_12m: "LEAK", confidence: "LEAK" }, { get: (t, k) => (read.push(String(k)), (t as Record<string, unknown>)[k as string]) });
    buildTrackingIssue({ ...base, item });
    expect(new Set(read)).toEqual(new Set(OUTBOUND_ITEM_FIELDS));
  });
  it("neutralises our markers and @mentions in user text, and drops unsafe links", () => {
    const b = buildTrackingIssue({ ...base, item: { ...base.item, summary: "Hi @octocat <!-- pv:end --> bye" }, artifacts: [{ label: "x](http://evil) [y", url: "javascript:alert(1)" }, { label: "ok", url: "https://a.test/(x)" }] });
    expect(b.block.match(/<!-- pv:end -->/g)).toHaveLength(1);
    expect(b.block).not.toContain("@octocat");
    expect(b.block).not.toContain("javascript:");
    expect(b.block).not.toContain("https://a.test/(x)");
    expect(sanitize("a@b.com and @user")).toBe("a@b.com and @​user");
  });
  it("labels a project safely", () => {
    expect(projectLabel("Mobile App / EU!")).toBe("pv:project/mobile-app-eu");
    expect(projectLabel("???")).toBe("pv:project/project");
  });
});

describe("mergeBody", () => {
  const block = (t: string) => `${BLOCK_START} item=${ID} -->\n${t}\n${BLOCK_END}`;
  it("replaces only the managed block and keeps text before and after it", () => {
    const existing = `Notes from engineering\n\n${block("old")}\n\nMore notes`;
    const merged = mergeBody(existing, block("new"));
    expect(merged).toBe(`Notes from engineering\n\n${block("new")}\n\nMore notes`);
    expect(outsideBlock(merged)).toBe("Notes from engineering\n\n\n\nMore notes".replace(/\n\n\n\n/, "\n\n\n\n"));
  });
  it("appends the block to a body that has none, and uses the block alone for an empty body", () => {
    expect(mergeBody("Hand-written", block("x"))).toBe(`Hand-written\n\n${block("x")}`);
    expect(mergeBody("", block("x"))).toBe(block("x"));
    expect(mergeBody(null, block("x"))).toBe(block("x"));
  });
});

describe("pushTrackingIssue", () => {
  const built = buildTrackingIssue(base);
  it("creates once, sends nothing when unchanged, and never duplicates", async () => {
    const sc = new MemorySourceControl();
    const r1 = await pushTrackingIssue(sc, 1, "acme/road", ID, built, null);
    expect(r1.kind).toBe("created");
    expect(sc.issues.size).toBe(1);
    const num = (r1 as { issue: { number: number } }).issue.number;
    sc.calls.length = 0;
    expect(await pushTrackingIssue(sc, 1, "acme/road", ID, built, { issueNumber: num, lastPushedHash: built.hash })).toEqual({ kind: "unchanged" });
    expect(sc.calls).toEqual([]);
  });
  it("recovers a create whose answer was lost by finding the marker, instead of creating a second issue", async () => {
    const sc = new MemorySourceControl();
    await pushTrackingIssue(sc, 1, "acme/road", ID, built, null);
    const again = await pushTrackingIssue(sc, 1, "acme/road", ID, buildTrackingIssue({ ...base, item: { ...base.item, summary: "New text" } }), null);
    expect(again.kind).toBe("updated");
    expect(sc.issues.size).toBe(1);
  });
  it("an update keeps text outside the block and the labels people added", async () => {
    const sc = new MemorySourceControl();
    const r = (await pushTrackingIssue(sc, 1, "acme/road", ID, built, null)) as { issue: { number: number } };
    const issue = sc.issues.get(`acme/road#${r.issue.number}`)!;
    issue.body = `Engineering notes\n\n${issue.body}\n\nFooter`;
    issue.labels.push("bug");
    const next = buildTrackingIssue({ ...base, item: { ...base.item, initiative_name: "Renamed" } });
    await pushTrackingIssue(sc, 1, "acme/road", ID, next, { issueNumber: r.issue.number, lastPushedHash: built.hash });
    expect(issue.title).toBe("R-12: Renamed");
    expect(issue.body.startsWith("Engineering notes")).toBe(true);
    expect(issue.body.endsWith("Footer")).toBe(true);
    expect(issue.body).toContain("Cut steps.");
    expect(issue.labels).toEqual(expect.arrayContaining(["bug", "product-velocity", "pv:project/mobile-app"]));
  });
  it("reports a deleted issue instead of recreating it", async () => {
    const sc = new MemorySourceControl();
    expect(await pushTrackingIssue(sc, 1, "acme/road", ID, built, { issueNumber: 999, lastPushedHash: "old" })).toEqual({ kind: "missing" });
    expect(sc.issues.size).toBe(0);
  });
  it("a GitHub failure propagates and leaves nothing half-made", async () => {
    const sc = new MemorySourceControl();
    sc.failNext = new GitHubError(403, "x");
    await expect(pushTrackingIssue(sc, 1, "acme/road", ID, built, null)).rejects.toBeInstanceOf(GitHubError);
    expect(sc.issues.size).toBe(0);
  });
});

describe("describePushError", () => {
  it("is short, helpful and never contains a body or token", () => {
    expect(describePushError(new GitHubError(404, "ghs_secret in body"))).not.toContain("ghs_");
    expect(describePushError(new GitHubError(429, "x", 30))).toContain("30");
    expect(describePushError(new Error("token ghs_abc"))).toBe("The push did not finish. Try again.");
  });
});

describe("planAction", () => {
  const active = new Set(["acme/road"]);
  const base = { defaultRepo: "acme/road", activeRepos: active, hash: "h", projectName: "Mobile" };
  const link = (over: Record<string, unknown> = {}) => ({ mode: "push" as const, repo: "acme/road", issueNumber: 7, syncState: "synced", lastPushedHash: "h", ...over });
  it("creates, updates and skips unchanged items", () => {
    expect(planAction({ ...base, link: null })).toEqual({ repo: "acme/road", action: "create" });
    expect(planAction({ ...base, link: link({ lastPushedHash: "old" }) })).toMatchObject({ action: "update" });
    expect(planAction({ ...base, link: link() })).toMatchObject({ action: "unchanged" });
    expect(planAction({ ...base, link: link({ syncState: "error" }) })).toMatchObject({ action: "update" });
  });
  it("blocks a missing default repository and a repository that left the connection", () => {
    expect(planAction({ ...base, defaultRepo: null, link: null })).toMatchObject({ action: "blocked", reason: expect.stringContaining("Mobile") });
    expect(planAction({ ...base, activeRepos: new Set(), link: null })).toMatchObject({ action: "blocked" });
  });
  it("never writes to a repository marked read-only, whether it is new or already linked", () => {
    const readOnlyRepos = new Set(["acme/road"]);
    expect(planAction({ ...base, readOnlyRepos, link: null })).toMatchObject({ action: "blocked", reason: expect.stringContaining("read-only") });
    expect(planAction({ ...base, readOnlyRepos, link: link({ lastPushedHash: "old" }) })).toMatchObject({ action: "blocked" });
    expect(planAction({ ...base, readOnlyRepos: new Set(["other/repo"]), link: null })).toMatchObject({ action: "create" });
  });
  it("never pushes to a link that only follows an existing issue", () => {
    for (const hash of ["h", "other"]) expect(planAction({ ...base, hash, link: link({ mode: "follow", repo: "Product-Velocity/app", issueNumber: 31 }) })).toMatchObject({ action: "blocked", reason: expect.stringContaining("#31") });
  });
});
