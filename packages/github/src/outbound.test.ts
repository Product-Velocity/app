import { describe, expect, it } from "vitest";
import { moscowLabel, rankBandLabel, planAction, BLOCK_END, BLOCK_START, buildTrackingIssue, describePushError, GitHubError, MemorySourceControl, mergeBody, OUTBOUND_ITEM_FIELDS, outsideBlock, projectLabel, pushTrackingIssue, sanitize } from "./index";

const ID = "11111111-1111-4111-8111-111111111111";
const base = { item: { item_code: "R-12", initiative_name: "Faster checkout", summary: "Cut steps.", description: undefined as string | undefined, hypothesis: "IF we cut steps THEN conversion rises" }, itemId: ID, projectName: "Mobile App", appUrl: "https://productvelocity.app", artifacts: [{ label: "PRD", url: "https://example.test/prd" }] };

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
  it("the Description is its own Markdown section between Summary and Hypothesis, and only appears when there is one", () => {
    const md = "### Scope\n\n- parse the file\n- map the columns\n\n| a | b |\n|---|---|\n| 1 | 2 |";
    const b = buildTrackingIssue({ ...base, item: { ...base.item, description: md } });
    const at = (h: string) => b.block.indexOf(h);
    expect(b.block).toContain(`## Description\n${md}`);
    expect(at("## Summary")).toBeLessThan(at("## Description"));
    expect(at("## Description")).toBeLessThan(at("## Hypothesis"));
    expect(buildTrackingIssue(base).block).not.toContain("## Description");
    expect(buildTrackingIssue({ ...base, item: { ...base.item, description: "  " } }).block).not.toContain("## Description");
    expect(b.hash).not.toBe(buildTrackingIssue(base).hash);
  });
  it("the Description is sanitised like other user text and cut at 20,000 characters", () => {
    const b = buildTrackingIssue({ ...base, item: { ...base.item, description: "Ask @octocat <!-- pv:end --> now" } });
    expect(b.block.match(/<!-- pv:end -->/g)).toHaveLength(1);
    expect(b.block).not.toContain("@octocat");
    const long = buildTrackingIssue({ ...base, item: { ...base.item, description: "x".repeat(25000) } });
    expect(long.block.length).toBeLessThan(21000 + 2000);
    expect(long.block.length).toBeLessThan(65536); // GitHub's limit for an issue body
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

describe("labels PV owns (the pv: namespace)", () => {
  const withItem = (extra: Record<string, unknown>) => buildTrackingIssue({ ...base, item: { ...base.item, ...extra } });
  it("MoSCoW and a rank band become pv: labels next to the base and project labels", () => {
    expect(withItem({ moscow: "Must", stack_rank: 3 }).labels).toEqual(["product-velocity", "pv:project/mobile-app", "pv:moscow/must", "pv:rank/top-10"]);
    expect(withItem({ moscow: "Won't", stack_rank: 80 }).labels).toEqual(["product-velocity", "pv:project/mobile-app", "pv:moscow/wont", "pv:rank/later"]);
  });
  it("rank bands: top 10, top 25, top 50, later; no label without a rank", () => {
    expect(rankBandLabel(1)).toBe("pv:rank/top-10");
    expect(rankBandLabel(10)).toBe("pv:rank/top-10");
    expect(rankBandLabel(11)).toBe("pv:rank/top-25");
    expect(rankBandLabel(25)).toBe("pv:rank/top-25");
    expect(rankBandLabel(26)).toBe("pv:rank/top-50");
    expect(rankBandLabel(50)).toBe("pv:rank/top-50");
    expect(rankBandLabel(51)).toBe("pv:rank/later");
    expect(rankBandLabel(null)).toBeNull();
    expect(rankBandLabel(0)).toBeNull();
    expect(rankBandLabel("LEAK_STACK_RANK")).toBeNull();
  });
  it("the exact rank number is never in a label or the body", () => {
    const b = withItem({ moscow: "Should", stack_rank: 37 });
    expect(JSON.stringify([b.labels, b.block])).not.toMatch(/\b37\b/);
  });
  it("no label for an unknown or empty MoSCoW, and a changed band changes the hash", () => {
    expect(moscowLabel("Maybe")).toBeNull();
    expect(moscowLabel(null)).toBeNull();
    expect(withItem({ stack_rank: 3 }).hash).not.toBe(withItem({ stack_rank: 30 }).hash);
  });
  it("a push adds the new pv: labels and REMOVES the pv: labels it no longer should have, never a label of anyone else's", async () => {
    const sc = new MemorySourceControl();
    const first = buildTrackingIssue({ ...base, item: { ...base.item, moscow: "Must", stack_rank: 3 } });
    const created = await pushTrackingIssue(sc, 1, "acme/road", ID, first, null);
    if (created.kind !== "created") throw new Error("expected create");
    const issue = sc.issues.get(`acme/road#${created.issue.number}`)!;
    issue.labels.push("bug", "needs-design", "pv:something-custom-by-us-later");
    const next = buildTrackingIssue({ ...base, item: { ...base.item, moscow: "Should", stack_rank: 30 } });
    await pushTrackingIssue(sc, 1, "acme/road", ID, next, { issueNumber: created.issue.number, lastPushedHash: first.hash });
    expect(issue.labels).toEqual(expect.arrayContaining(["product-velocity", "pv:project/mobile-app", "pv:moscow/should", "pv:rank/top-50", "bug", "needs-design"]));
    expect(issue.labels).not.toContain("pv:moscow/must");
    expect(issue.labels).not.toContain("pv:rank/top-10");
    expect(sc.removed).toEqual(["pv:moscow/must", "pv:rank/top-10", "pv:something-custom-by-us-later"]);
  });
  it("clearing MoSCoW removes its label; an unchanged item sends nothing, so removes nothing", async () => {
    const sc = new MemorySourceControl();
    const a = buildTrackingIssue({ ...base, item: { ...base.item, moscow: "Could" } });
    const c = await pushTrackingIssue(sc, 1, "acme/road", ID, a, null);
    if (c.kind !== "created") throw new Error("expected create");
    const b = buildTrackingIssue(base);
    await pushTrackingIssue(sc, 1, "acme/road", ID, b, { issueNumber: c.issue.number, lastPushedHash: a.hash });
    expect(sc.issues.get(`acme/road#${c.issue.number}`)!.labels).not.toContain("pv:moscow/could");
    const before = sc.calls.length;
    expect((await pushTrackingIssue(sc, 1, "acme/road", ID, b, { issueNumber: c.issue.number, lastPushedHash: b.hash })).kind).toBe("unchanged");
    expect(sc.calls.length).toBe(before);
  });
  it("a project renamed in PV swaps its pv:project label", async () => {
    const sc = new MemorySourceControl();
    const a = buildTrackingIssue(base);
    const c = await pushTrackingIssue(sc, 1, "acme/road", ID, a, null);
    if (c.kind !== "created") throw new Error("expected create");
    const b = buildTrackingIssue({ ...base, projectName: "Checkout" });
    await pushTrackingIssue(sc, 1, "acme/road", ID, b, { issueNumber: c.issue.number, lastPushedHash: a.hash });
    const labels = sc.issues.get(`acme/road#${c.issue.number}`)!.labels;
    expect(labels).toContain("pv:project/checkout");
    expect(labels).not.toContain("pv:project/mobile-app");
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
