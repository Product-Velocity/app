import { describe, expect, it } from "vitest";
import { adfToText, inlineToAdf, isSimpleAdf, markdownToAdf } from "./adf";

describe("markdownToAdf", () => {
  it("makes headings, paragraphs, lists and code blocks", () => {
    const d = markdownToAdf("# Title\n\nFirst line\nsecond line\n\n- a\n- b\n\n1. one\n2. two\n\n```ts\nconst x = 1;\n```");
    expect(d.content.map((n) => n.type)).toEqual(["heading", "paragraph", "bulletList", "orderedList", "codeBlock"]);
    expect(d.content[1]!.content![0]).toEqual({ type: "text", text: "First line second line" });
    expect(d.content[4]!.attrs).toEqual({ language: "ts" });
  });
  it("marks bold, italic, code and safe links; an unsafe link is plain text", () => {
    const t = inlineToAdf("a **b** *c* `d` [e](https://x.test/p) [f](javascript:alert(1))");
    expect(t.find((x) => x.text === "b")!.marks).toEqual([{ type: "strong" }]);
    expect(t.find((x) => x.text === "c")!.marks).toEqual([{ type: "em" }]);
    expect(t.find((x) => x.text === "d")!.marks).toEqual([{ type: "code" }]);
    expect(t.find((x) => x.text === "e")!.marks).toEqual([{ type: "link", attrs: { href: "https://x.test/p" } }]);
    expect(t.find((x) => x.text === "f")!.marks).toBeUndefined();
  });
  it("gives a valid document for empty text, and keeps raw HTML as text", () => {
    expect(markdownToAdf("").content).toEqual([{ type: "paragraph", content: [] }]);
    expect(JSON.stringify(markdownToAdf("<script>alert(1)</script>"))).toContain("<script>");
    expect(markdownToAdf("<script>x</script>").content[0]!.type).toBe("paragraph");
  });
  it("round trips to the same text and is simple ADF", () => {
    const d = markdownToAdf("Hello **world**\n\n- one\n- two");
    expect(isSimpleAdf(d)).toBe(true);
    expect(adfToText(d)).toBe("Hello world\n- one\n- two");
  });
  it("recognises rich Jira content as not simple (table, mention, macro)", () => {
    expect(isSimpleAdf({ type: "doc", version: 1, content: [{ type: "table", content: [] }] })).toBe(false);
    expect(isSimpleAdf({ type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "mention", attrs: { id: "x", text: "@A" } }] }] })).toBe(false);
    expect(isSimpleAdf({ type: "doc", version: 1, content: [{ type: "extension", attrs: {} }] })).toBe(false);
  });
});
