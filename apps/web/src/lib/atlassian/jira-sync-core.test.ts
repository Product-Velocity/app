import { describe, expect, it } from "vitest";
import { hashText } from "@pv/github";
import { adfToText, markdownToAdf } from "./adf";
import { attachmentsHash, composeDescription, nodesText, splitDescription } from "./jira-sections";
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
    expect(p.newBase).toEqual({ title: h("Checkout"), summary: h(""), description: h(adfToText(markdownToAdf("Pay **fast**"))), hypothesis: h(""), attachments: attachmentsHash([], []) });
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

describe("the description as headed sections (issue #319, decision 2026-11-04-jira-description-sections)", () => {
  const ART = [{ label: "PRD", url: "https://example.test/prd" }];
  const FILES = [{ label: "Shot", url: "https://example.test/f/T/Shot.png" }];
  const full = pv({ summary: "Short", hypothesis: "IF a THEN b" });
  /** A Jira issue whose description was written by Sync with sections, and the base of that write. */
  const sectioned = (p: PvItem, links: { artifacts?: typeof ART; files?: typeof FILES } = {}) => {
    const d = composeDescription({ pv: { summary: p.summary ?? "", description: p.description ?? "", hypothesis: p.hypothesis ?? "" }, ...links });
    const base = { title: h(p.name), summary: h(adfToText(markdownToAdf(p.summary ?? ""))), description: h(adfToText(markdownToAdf(p.description ?? ""))), hypothesis: h(adfToText(markdownToAdf(p.hypothesis ?? ""))), attachments: attachmentsHash(links.artifacts, links.files) };
    return { description: d, base };
  };
  const text = (p: { fields: Record<string, unknown> }) => adfToText(p.fields.description);

  it("a new issue gets all the sections, the links and the files, in the order of the GitHub block", () => {
    const p = planJiraSend({ pv: full, jira: null, map: {}, create: { projectKey: "PLAT", issueTypeId: "10000" }, artifacts: ART, files: FILES });
    const t = text(p);
    expect(t.replace(/\n+/g, "|")).toBe("Summary|Short|Description|Pay fast|Hypothesis (IF / THEN / RESULTING IN)|IF a THEN b|Artifacts|- PRD|Files|- Shot");
    expect(p.newBase).toEqual({ title: h("Checkout"), summary: h("Short"), description: h("Pay fast"), hypothesis: h("IF a THEN b"), attachments: attachmentsHash(ART, FILES) });
  });
  it("in step: nothing is written, even with links and files", () => {
    const s = sectioned(full, { artifacts: ART, files: FILES });
    const first = planJiraSend({ pv: full, jira: jira({ description: s.description }), base: s.base, map: {}, artifacts: ART, files: FILES });
    const again = planJiraSend({ pv: full, jira: jira({ description: s.description }), base: s.base, map: {}, artifacts: ART, files: FILES, sentHash: first.sentHash });
    expect(again.action).toBe("unchanged");
    expect(again.fields.description).toBeUndefined();
  });
  it("an issue written before sections existed is left alone when the item has nothing for the new sections (no mass rewrite)", () => {
    const p = plan({ pv: pv(), sentHash: plan().sentHash });
    expect(p.action).toBe("unchanged");
    expect(p.fields.description).toBeUndefined();
  });
  it("an issue written before sections existed gets them when the item has a Summary: Jira's text stays as the Description, with a note", () => {
    const p = plan({ pv: full });
    expect(p.writes).toEqual(["summary", "hypothesis"]);
    const t = text(p).replace(/\n+/g, "|");
    expect(t).toBe("Summary|Short|Description|Pay fast|Hypothesis (IF / THEN / RESULTING IN)|IF a THEN b");
    expect(p.notes.join(" ")).toContain("gets headed sections");
    expect(p.unresolved).toEqual([]);
  });
  it("a change of the links alone rewrites the description, keeping Jira's own content of the sections", () => {
    const s = sectioned(full, { artifacts: ART });
    const withTable = splitDescription(s.description);
    const p = planJiraSend({ pv: full, jira: jira({ description: s.description }), base: s.base, map: {}, artifacts: [...ART, { label: "Spec", url: "https://example.test/spec" }] });
    expect(p.writes).toEqual([]);
    expect(text(p)).toContain("- Spec");
    expect(nodesText(splitDescription(p.fields.description).nodes.summary)).toBe("Short");
    expect(withTable.legacy).toBe(false);
    expect(p.newBase.attachments).toBe(attachmentsHash([...ART, { label: "Spec", url: "https://example.test/spec" }], []));
  });
  it("links never recorded before are written once (the one-time switch), then not again", () => {
    const s = sectioned(full);
    const { attachments: _a, ...oldBase } = s.base;
    void _a;
    const first = planJiraSend({ pv: full, jira: jira({ description: s.description }), base: oldBase, map: {}, artifacts: ART });
    expect(text(first)).toContain("- PRD");
    const next = sectioned(full, { artifacts: ART });
    const second = planJiraSend({ pv: full, jira: jira({ description: next.description }), base: { ...oldBase, ...first.newBase }, map: {}, artifacts: ART, sentHash: first.sentHash });
    expect(second.action).toBe("unchanged");
  });
  it("only Jira changed the hypothesis: a conflict on that section only, nothing is written until it is chosen", () => {
    const s = sectioned(full);
    const edited = composeDescription({ pv: { summary: "Short", description: "Pay **fast**", hypothesis: "IF changed in Jira" } });
    const open = planJiraSend({ pv: full, jira: jira({ description: edited }), base: s.base, map: {} });
    expect(open.unresolved).toEqual(["hypothesis"]);
    expect(open.fields.description).toBeUndefined();
    const keepJira = planJiraSend({ pv: full, jira: jira({ description: edited }), base: s.base, map: {}, picks: { hypothesis: "jira" } });
    expect(keepJira.takeOver).toEqual({ hypothesis: "IF changed in Jira" });
    expect(keepJira.newBase.hypothesis).toBe(h("IF changed in Jira"));
    const keepPv = planJiraSend({ pv: full, jira: jira({ description: edited }), base: s.base, map: {}, picks: { hypothesis: "pv" } });
    expect(keepPv.writes).toEqual(["hypothesis"]);
    expect(text(keepPv)).toContain("IF a THEN b");
    expect(text(keepPv)).not.toContain("changed in Jira");
  });
  it("a section that is written replaces only itself: the other sections keep what Jira has, and text above the first heading stays", () => {
    const jiraDescription = markdownToAdf("Typed above\n\n## Summary\n\nSummary in Jira\n\n## Description\n\nPay **fast**\n\n## Hypothesis (IF / THEN / RESULTING IN)\n\nold hypothesis");
    const base = { title: h("Checkout"), summary: h("Summary in Jira"), description: h("Pay fast"), hypothesis: h("old hypothesis"), attachments: attachmentsHash([], []) };
    const p = planJiraSend({ pv: pv({ summary: "Summary in Jira", hypothesis: "new hypothesis" }), jira: jira({ description: jiraDescription }), base, map: {} });
    expect(p.writes).toEqual(["hypothesis"]);
    expect(text(p).replace(/\n+/g, "|")).toBe("Typed above|Summary|Summary in Jira|Description|Pay fast|Hypothesis (IF / THEN / RESULTING IN)|new hypothesis");
  });
  it("replacing a section that holds a table or a macro says so", () => {
    const rich = { type: "doc", version: 1, content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Description" }] }, { type: "paragraph", content: [{ type: "text", text: "Pay fast" }] }, { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Hypothesis (IF / THEN / RESULTING IN)" }] }, { type: "extension", attrs: { extensionKey: "macro" } }] };
    const p = planJiraSend({ pv: pv({ hypothesis: "new" }), jira: jira({ description: rich }), base: { title: h("Checkout"), description: h("Pay fast"), hypothesis: h(""), summary: h(""), attachments: attachmentsHash([], []) }, map: {}, picks: { hypothesis: "pv" } });
    expect(p.unresolved).toEqual([]);
    expect(p.notes.join(" ")).toMatch(/Hypothesis in Jira has content Product Velocity cannot write back/);
  });
  it("the Artifacts and Files sections can be switched off per project, and the preview says so", () => {
    const p = planJiraSend({ pv: full, jira: null, map: { off: ["jira.body.artifacts", "jira.body.files"] }, create: { projectKey: "PLAT", issueTypeId: "10000" }, artifacts: ART, files: FILES });
    expect(text(p)).not.toMatch(/Artifacts|Files|PRD|Shot/);
    expect(p.notes.join(" ")).toMatch(/Artifact links not sent.*\n?.*File links not sent|File links not sent/);
  });
});
