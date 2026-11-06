import { describe, expect, it } from "vitest";
import { adfToText, markdownToAdf } from "./adf";
import { attachmentsHash, composeDescription, nodesText, splitDescription } from "./jira-sections";

const pv = { summary: "Short", description: "Long **text**", hypothesis: "IF a THEN b" };
const links = [{ label: "PRD", url: "https://example.test/prd" }];

describe("composeDescription", () => {
  it("writes the sections in order under level-2 headings and leaves empty ones out", () => {
    const d = composeDescription({ pv, artifacts: links, files: [{ label: "Shot", url: "https://example.test/f" }] });
    expect(d.content.filter((n) => n.type === "heading").map((n) => adfToText({ type: "doc", version: 1, content: [n] }))).toEqual(["Summary", "Description", "Hypothesis (IF / THEN / RESULTING IN)", "Links", "Files"]);
    const t = adfToText(d);
    expect(t.indexOf("Short")).toBeLessThan(t.indexOf("Long text"));
    expect(t).toContain("- PRD");
    const slim = composeDescription({ pv: { summary: "", description: "Only this", hypothesis: "" } });
    expect(adfToText(slim)).toBe("Description\nOnly this");
  });
  it("an empty item gives an empty document, and unsafe links are dropped", () => {
    expect(composeDescription({ pv: { summary: "", description: "", hypothesis: "" } }).content).toHaveLength(1);
    const d = composeDescription({ pv, artifacts: [{ label: "x", url: "javascript:alert(1)" }, { label: "y", url: "https://a.test/a b" }] });
    expect(adfToText(d)).not.toMatch(/Links|javascript/);
  });
});

describe("splitDescription", () => {
  it("is the inverse of composeDescription for the three texts", () => {
    const s = splitDescription(composeDescription({ pv, artifacts: links }));
    expect(s.legacy).toBe(false);
    expect(nodesText(s.nodes.summary)).toBe("Short");
    expect(nodesText(s.nodes.description)).toBe("Long text");
    expect(nodesText(s.nodes.hypothesis)).toBe("IF a THEN b");
    expect(s.head).toEqual([]);
  });
  it("a description without our headings is the Description (written before, or typed in Jira)", () => {
    const s = splitDescription(markdownToAdf("Just some text\n\n## My own heading\n\nmore"));
    expect(s.legacy).toBe(true);
    expect(nodesText(s.nodes.description)).toContain("Just some text");
    expect(s.nodes.summary).toBeUndefined();
    expect(splitDescription(null)).toEqual({ legacy: true, head: [], nodes: {} });
  });
  it("text above the first heading is kept apart, not compared", () => {
    const d = markdownToAdf("Typed in Jira\n\n## Summary\n\nS\n\n## Description\n\nD");
    const s = splitDescription(d);
    expect(nodesText(s.head)).toBe("Typed in Jira");
    expect(nodesText(s.nodes.summary)).toBe("S");
  });
  it("a heading that repeats one of ours inside a section stays in that section", () => {
    const s = splitDescription(markdownToAdf("## Description\n\nintro\n\n## Summary\n\nafter"));
    // Summary comes after Description here, so it is out of order: it is not a section start
    expect(nodesText(s.nodes.description)).toContain("after");
    expect(s.nodes.summary).toBeUndefined();
  });
  it("only level-2 headings count", () => {
    const s = splitDescription(markdownToAdf("### Summary\n\nx"));
    expect(s.legacy).toBe(true);
  });
});

describe("keeping Jira's own content", () => {
  it("a kept section keeps its nodes exactly; the others come from Product Velocity; the head stays", () => {
    const jira = markdownToAdf("Above\n\n## Summary\n\nJira summary **rich**\n\n## Description\n\nold");
    const s = splitDescription(jira);
    const d = composeDescription({ pv: { summary: "PV summary", description: "new", hypothesis: "H" }, keep: { summary: s.nodes.summary! }, head: s.head });
    const t = adfToText(d);
    expect(t.startsWith("Above")).toBe(true);
    expect(t).toContain("Jira summary rich");
    expect(t).not.toContain("PV summary");
    expect(t).toContain("new");
    expect(t).toContain("Hypothesis");
  });
  it("a kept empty section stays out even when Product Velocity has text for it (the person chose Jira's emptiness)", () => {
    const d = composeDescription({ pv, keep: { hypothesis: [] } });
    expect(adfToText(d)).not.toContain("IF a THEN b");
  });
});

describe("attachmentsHash", () => {
  it("changes with the links and is stable otherwise", () => {
    expect(attachmentsHash(links, [])).toBe(attachmentsHash(links, []));
    expect(attachmentsHash(links, [])).not.toBe(attachmentsHash([], []));
    expect(attachmentsHash([], links)).not.toBe(attachmentsHash(links, []));
  });
});
