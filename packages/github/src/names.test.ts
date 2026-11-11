import { describe, expect, it } from "vitest";
import { buildTrackingIssue, mergeBody, outsideBlock, MARKER } from "./outbound";
import { isOwnedLabel, validateNames, findBlock, NEUTRAL_FOOTER, labelDescription, resolveNames } from "./names";
import { descriptionFromIssueBody, splitManagedBlock } from "./inbound";
import { pushTrackingIssue } from "./push";
import { MemorySourceControl } from "./memory-source";

// Stealth mode (issue #411): names of labels, markers and footer. With no names everything is as before (the older tests pin that).
const ITEM = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
const item = { item_code: "PV-1", initiative_name: "Checkout", summary: "S", description: "D", hypothesis: "H", moscow: "Must", stack_rank: 3, change_type: "Bug", theme: "Payments", value_type: "Defend revenue", g2m_quarter: "Q3 2027", initiative_phase: "Define" };
const base = { item, itemId: ITEM, projectName: "Mobile App", appUrl: "https://app.example", artifacts: [] };
const STEALTH = { prefix: { moscow: "moscow/", rank: "rank/", type: "type/", group: "group/", project: "project/", value: "value/", quarter: "quarter/" }, base: "", removed: "removed", define: "in-review", block: "sync", hideBrand: true };

describe("buildTrackingIssue under other names", () => {
  it("labels use the chosen text, no base label, and nothing says pv or Product Velocity", () => {
    const b = buildTrackingIssue({ ...base, names: STEALTH });
    expect(b.labels).toEqual(["project/mobile-app", "moscow/must", "rank/top-10", "type/bug", "group/payments", "value/defend-revenue", "quarter/q3-2027", "in-review"]);
    expect(b.block).not.toMatch(/pv|product velocity|app\.example/i);
    expect(b.block).toContain("<!-- sync:begin item=");
    expect(b.block).toContain(NEUTRAL_FOOTER);
    expect(b.block.endsWith("<!-- sync:end -->")).toBe(true);
  });
  it("without names the output is today's", () => {
    const b = buildTrackingIssue(base);
    expect(b.labels).toEqual(["product-velocity", "pv:project/mobile-app", "pv:moscow/must", "pv:rank/top-10", "pv:type/bug", "pv:group/payments", "pv:value/defend-revenue", "pv:quarter/q3-2027", "pv:define"]);
    expect(b.block).toContain("Managed by Product Velocity");
    expect(b.hash).toBe(buildTrackingIssue({ ...base, names: {} }).hash);
  });
  it("a name change changes the hash, so the next Sync rewrites the issue", () => {
    expect(buildTrackingIssue({ ...base, names: STEALTH }).hash).not.toBe(buildTrackingIssue(base).hash);
  });
});

describe("ownership of labels", () => {
  it("the current names and always the old pv: namespace and base label are ours; the removed label and people's labels are not", () => {
    for (const l of ["moscow/must", "in-review", "project/x"]) expect(isOwnedLabel(l, STEALTH), l).toBe(true);
    for (const l of ["pv:moscow/must", "product-velocity", "pv:whatever"]) expect(isOwnedLabel(l, STEALTH), l).toBe(true);
    for (const l of ["removed", "pv:removed", "bug", "team-a"]) expect(isOwnedLabel(l, STEALTH), l).toBe(false);
    expect(isOwnedLabel("moscow/must")).toBe(false); // by default only pv: is ours
  });
});

describe("the managed block is found under any marker word", () => {
  const legacy = buildTrackingIssue(base).block;
  const stealth = buildTrackingIssue({ ...base, names: STEALTH }).block;
  it("a push under new names replaces a block written under the old ones, and keeps the text outside", () => {
    const body = `before\n\n${legacy}\n\nafter`;
    const merged = mergeBody(body, stealth);
    expect(merged).toContain("<!-- sync:begin");
    expect(merged).not.toContain("pv:begin");
    expect(outsideBlock(merged)).toBe(outsideBlock(body));
    expect(merged.startsWith("before")).toBe(true);
    expect(merged.endsWith("after")).toBe(true);
  });
  it("the three texts are read back from either footer", () => {
    for (const block of [legacy, stealth]) {
      expect(splitManagedBlock(block)).toMatchObject({ ok: true, summary: "S", description: "D", hypothesis: "H" });
      expect(findBlock(block)).not.toBeNull();
    }
    expect(descriptionFromIssueBody(`mine\n${stealth}`)).toEqual({ text: "mine", hadBlock: true });
    expect(MARKER(ITEM, STEALTH)).toBe(`<!-- sync:begin item=${ITEM} -->`);
  });
  it("a marker someone edited is still refused", () => {
    expect(splitManagedBlock(stealth.replace("item=", "itm="))).toMatchObject({ ok: false });
  });
});

describe("pushTrackingIssue under other names", () => {
  it("adds the new labels and removes the old pv: ones; label and milestone descriptions are empty in stealth", async () => {
    const sc = new MemorySourceControl();
    const first = await pushTrackingIssue(sc, 1, "acme/road", ITEM, buildTrackingIssue(base), null);
    expect(first.kind).toBe("created");
    const issue = (first as { issue: { number: number } }).issue;
    const second = await pushTrackingIssue(sc, 1, "acme/road", ITEM, buildTrackingIssue({ ...base, names: STEALTH }), { issueNumber: issue.number, lastPushedHash: "old" }, STEALTH);
    expect(second.kind).toBe("updated");
    const labels = sc.issues.get(`acme/road#${issue.number}`)!.labels;
    expect(labels).toEqual(expect.arrayContaining(["moscow/must", "rank/top-10", "in-review"]));
    expect(labels.some((l) => l.startsWith("pv:") || l === "product-velocity")).toBe(false);
    expect(sc.issues.get(`acme/road#${issue.number}`)!.body).not.toMatch(/product velocity|pv:/i);
  });
});

describe("validateNames", () => {
  it("accepts the defaults and a stealth set", () => {
    expect(validateNames({})).toEqual([]);
    expect(validateNames(STEALTH)).toEqual([]);
  });
  it("refuses bad text and clashes", () => {
    expect(validateNames({ prefix: { moscow: "no slash" } })).not.toEqual([]);
    expect(validateNames({ prefix: { moscow: "a/", rank: "a/" } })).not.toEqual([]);
    expect(validateNames({ removed: "x", define: "x" })).not.toEqual([]);
    expect(validateNames({ block: "Bad Word" })).not.toEqual([]);
    expect(validateNames({ jiraMarker: "item" })).not.toEqual([]);
  });
  it("hides the brand in descriptions only when asked", () => {
    expect(labelDescription()).toBe("Managed by Product Velocity");
    expect(labelDescription({ hideBrand: true })).toBe("");
    expect(resolveNames({ base: "" }).base).toBe("");
  });
});
