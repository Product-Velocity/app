import { describe, expect, it } from "vitest";
import { adfToMarkdown, markdownToAdf } from "./adf";

const doc = (...content: unknown[]) => ({ type: "doc", version: 1, content });
const p = (...c: unknown[]) => ({ type: "paragraph", content: c });
const t = (text: string, ...marks: { type: string; attrs?: unknown }[]) => ({ type: "text", text, ...(marks.length ? { marks } : {}) });

describe("adfToMarkdown (a Jira description kept once at pull-in)", () => {
  it("reads paragraphs, headings and inline marks", () => {
    const md = adfToMarkdown(doc({ type: "heading", attrs: { level: 2 }, content: [t("Goal")] }, p(t("Plain "), t("bold", { type: "strong" }), t(" "), t("it", { type: "em" }), t(" "), t("code", { type: "code" }))));
    expect(md).toBe("## Goal\n\nPlain **bold** *it* `code`");
  });
  it("keeps http(s) links and drops any other scheme", () => {
    expect(adfToMarkdown(doc(p(t("site", { type: "link", attrs: { href: "https://example.com/a" } }), t(" "), t("bad", { type: "link", attrs: { href: "javascript:alert(1)" } }))))).toBe("[site](https://example.com/a) bad");
  });
  it("reads bullet, numbered and nested lists", () => {
    const li = (...c: unknown[]) => ({ type: "listItem", content: c });
    const md = adfToMarkdown(doc({ type: "bulletList", content: [li(p(t("one"), ), { type: "bulletList", content: [li(p(t("nested")))] }), li(p(t("two")))] }, { type: "orderedList", content: [li(p(t("first"))), li(p(t("second")))] }));
    expect(md).toBe("- one\n  - nested\n- two\n\n1. first\n2. second");
  });
  it("reads code blocks, quotes, rules and a plain table", () => {
    const cell = (s: string, type = "tableCell") => ({ type, content: [p(t(s))] });
    const md = adfToMarkdown(doc(
      { type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "const a = 1;" }] },
      { type: "blockquote", content: [p(t("quoted"))] },
      { type: "rule" },
      { type: "table", content: [{ type: "tableRow", content: [cell("A", "tableHeader"), cell("B", "tableHeader")] }, { type: "tableRow", content: [cell("1"), cell("2")] }] },
    ));
    expect(md).toBe("```ts\nconst a = 1;\n```\n\n> quoted\n\n---\n\n| A | B |\n| --- | --- |\n| 1 | 2 |");
  });
  it("reads the content of panels and unknown blocks, leaves media out, and survives garbage", () => {
    expect(adfToMarkdown(doc({ type: "panel", attrs: { panelType: "info" }, content: [p(t("Heads up"))] }, { type: "mediaSingle", content: [{ type: "media", attrs: { id: "x" } }] }, p(t("After"))))).toBe("Heads up\n\nAfter");
    expect(adfToMarkdown(null)).toBe("");
    expect(adfToMarkdown("text")).toBe("");
    expect(adfToMarkdown(doc())).toBe("");
  });
  it("round-trips the text Product Velocity writes", () => {
    const md = "## Goal\n\nThe IO builder with **costs**\n\n- one\n- two";
    expect(adfToMarkdown(markdownToAdf(md))).toBe(md);
  });
});
