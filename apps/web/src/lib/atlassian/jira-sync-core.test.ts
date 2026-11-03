import { describe, expect, it } from "vitest";
import { hashText } from "@pv/github";
import { adfToText, markdownToAdf } from "./adf";
import { compareJira, extrasHash, markerFor, planJiraSend, type PvItem } from "./jira-sync-core";

const pv = (o: Partial<PvItem> = {}): PvItem => ({ id: "11111111-1111-4111-8111-111111111111", name: "Checkout", description: "Pay **fast**", moscow: "Must", ...o });
const jiraDesc = (md: string) => markdownToAdf(md);
const jira = (o: Partial<{ summary: string; description: unknown; labels: string[] }> = {}) => ({ summary: "Checkout", description: jiraDesc("Pay **fast**"), labels: ["product-velocity", "pv:moscow/must"], ...o });
const h = (s: string) => hashText(s);
const inStep = { title: h("Checkout"), description: h(adfToText(jiraDesc("Pay **fast**"))) };
const plan = (o: object = {}) => planJiraSend({ pv: pv(), jira: jira(), base: inStep, map: {}, ...o });

describe("three-way compare (the table of docs/21 for Jira)", () => {
  it("in step: nothing to send, and the extras are re-sent only when they changed", () => {
    const first = plan();
    expect(first.action).toBe("update"); // never sent before: the extras (labels already right, no due date) hash differs from the empty stored hash
    const again = plan({ sentHash: first.sentHash });
    expect(again.action).toBe("unchanged");
    expect(again.fields).toEqual({});
  });
  it("only Product Velocity changed: the text goes out and the base moves to it", () => {
    const p = plan({ pv: pv({ name: "Checkout v2" }) });
    expect(p.writes).toEqual(["title"]);
    expect(p.fields.summary).toBe("Checkout v2");
    expect(p.fields.description).toBeUndefined(); // untouched rich Jira content is never rewritten
    expect(p.newBase.title).toBe(h("Checkout v2"));
  });
  it("only Jira changed: a conflict with no pick yet; Keep Product Velocity overwrites; Keep Jira takes it over", () => {
    const j = jira({ summary: "Checkout (renamed in Jira)" });
    const open = plan({ jira: j });
    expect(open.unresolved).toEqual(["title"]);
    expect(open.writes).toEqual([]);
    const keepPv = plan({ jira: j, picks: { title: "pv" } });
    expect(keepPv.writes).toEqual(["title"]);
    expect(keepPv.fields.summary).toBe("Checkout");
    const keepJira = plan({ jira: j, picks: { title: "jira" } });
    expect(keepJira.takeOver).toEqual({ initiative_name: "Checkout (renamed in Jira)" });
    expect(keepJira.fields.summary).toBeUndefined();
    expect(keepJira.newBase.title).toBe(h("Checkout (renamed in Jira)"));
  });
  it("both changed: a conflict for that field only", () => {
    const p = plan({ pv: pv({ name: "A" }), jira: jira({ summary: "B" }) });
    expect(p.unresolved).toEqual(["title"]);
    expect(compareJira(pv({ name: "A" }), jira({ summary: "B" }), inStep).fields[0]!.verdict).toBe("both");
  });
  it("both changed to the same text: no conflict", () => {
    expect(compareJira(pv({ name: "Same" }), jira({ summary: "Same" }), inStep).fields[0]!.verdict).toBe("none");
  });
  it("no base (never synced): a difference is a conflict, never a silent overwrite", () => {
    const p = planJiraSend({ pv: pv({ description: "" }), jira: jira(), base: null, map: {} });
    expect(p.unresolved).toEqual(["description"]);
    expect(p.writes).toEqual([]);
  });
  it("formatting that Jira adds does not make a false conflict", () => {
    const c = compareJira(pv({ description: "Pay **fast**\n\n\n- a\n- b" }), jira({ description: jiraDesc("Pay **fast**\n- a\n- b") }), null);
    expect(c.fields[1]!.verdict).toBe("none");
  });
  it("a description with a table, macro or mention is rich: PV changed it, the send warns that the whole description is replaced", () => {
    const rich = { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "Old" }] }, { type: "table", content: [] }] };
    const base = { title: inStep.title, description: h("Old") };
    const untouched = planJiraSend({ pv: pv({ description: "Old" }), jira: jira({ description: rich }), base, map: {} });
    expect(untouched.fields.description).toBeUndefined();
    expect(untouched.notes.join()).not.toMatch(/cannot write back/);
    const changed = planJiraSend({ pv: pv({ description: "New" }), jira: jira({ description: rich }), base, map: {} });
    expect(changed.writes).toEqual(["description"]);
    expect(changed.notes.join()).toMatch(/cannot write back/);
  });
});

describe("create", () => {
  it("builds the whole payload with the project, the issue type and an opaque marker label, never the item id", () => {
    const p = planJiraSend({ pv: pv(), jira: null, map: {}, create: { projectKey: "PLAT", issueTypeId: "10000" } });
    expect(p.action).toBe("create");
    expect(p.fields).toMatchObject({ project: { key: "PLAT" }, issuetype: { id: "10000" }, summary: "Checkout" });
    expect(p.fields.labels).toContain(markerFor(pv().id));
    expect(JSON.stringify(p.fields)).not.toContain(pv().id);
    expect(p.newBase).toEqual({ title: h("Checkout"), description: h(adfToText(markdownToAdf("Pay **fast**"))) });
  });
  it("the marker is stable per item and differs between items", () => {
    expect(markerFor("a")).toBe(markerFor("a"));
    expect(markerFor("a")).not.toBe(markerFor("b"));
    expect(markerFor("a")).toMatch(/^pv:item\/[0-9a-f]{16}$/);
  });
});

describe("extras", () => {
  it("a changed due date goes out and an unchanged one does not; people's labels stay", () => {
    const base = plan({ pv: pv({ g2m_date_est: "2027-03-31" }), jira: jira({ labels: ["mine", "product-velocity", "pv:moscow/must"] }) });
    expect(base.fields.duedate).toBe("2027-03-31");
    expect(base.fields.labels).toEqual(["mine", "product-velocity", "pv:moscow/must"]);
    const same = plan({ pv: pv({ g2m_date_est: "2027-03-31" }), jira: jira({ labels: ["mine", "product-velocity", "pv:moscow/must"] }), sentHash: base.sentHash });
    expect(same.action).toBe("unchanged");
    const moved = plan({ pv: pv({ g2m_date_est: "2027-04-30" }), jira: jira({ labels: ["mine", "product-velocity", "pv:moscow/must"] }), sentHash: base.sentHash });
    expect(moved.fields.duedate).toBe("2027-04-30");
  });
  it("a stale pv: label in Jira is corrected even when the hash matches", () => {
    const ok = plan();
    const p = plan({ jira: jira({ labels: ["product-velocity", "pv:moscow/could"] }), sentHash: ok.sentHash });
    expect(p.fields.labels).toEqual(["product-velocity", "pv:moscow/must"]);
  });
  it("extrasHash ignores order", () => {
    expect(extrasHash({ labels: ["b", "a"], duedate: "x" })).toBe(extrasHash({ duedate: "x", labels: ["a", "b"] }));
  });
});
