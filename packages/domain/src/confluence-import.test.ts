import { describe, expect, it } from "vitest";
import { markdownToStorage, pageBody } from "./confluence";
import { storageToMarkdown } from "./confluence-import";

const md = (s: string) => storageToMarkdown(s).markdown;

describe("Confluence storage format to Markdown", () => {
  it("headings, paragraphs, emphasis, code, links and line breaks", () => {
    expect(md("<h1>Title</h1><p>Some <strong>bold</strong>, <em>italic</em>, <code>code</code> and <del>gone</del> text.<br/>Next line.</p><h2>Sub</h2>"))
      .toBe("# Title\n\nSome **bold**, *italic*, `code` and ~~gone~~ text.  \nNext line.\n\n## Sub");
    expect(md('<p>see <a href="https://example.test/a?b=1&amp;c=2">the spec</a> now</p>')).toBe("see [the spec](https://example.test/a?b=1&c=2) now");
  });

  it("entities are decoded, and unsafe link targets keep only their text", () => {
    expect(md("<p>Fish &amp; chips &lt;3 &euro;5 &#8212; &#x2713; &nbsp;done</p>")).toBe("Fish & chips <3 €5 — ✓ done");
    expect(md('<p><a href="javascript:alert(1)">click</a> and <a href="data:text/html,x">data</a></p>')).toBe("click and data");
  });

  it("lists: unordered, ordered, nested, and a list item with several paragraphs", () => {
    expect(md("<ul><li>one</li><li>two<ul><li>nested</li></ul></li><li>three</li></ul>")).toBe("- one\n- two\n  - nested\n- three");
    expect(md("<ol><li>first</li><li>second</li></ol>")).toBe("1. first\n2. second");
    expect(md("<ul><li><p>a</p><p>b</p></li></ul>")).toBe("- a b");
  });

  it("tables become GitHub tables, with a header row when the first row has header cells, and notes merged cells", () => {
    const r = storageToMarkdown("<table><tbody><tr><th>Question</th><th>Answer</th></tr><tr><td>GTM needed?</td><td>Yes | maybe</td></tr></tbody></table>");
    expect(r.markdown).toBe("| Question | Answer |\n| --- | --- |\n| GTM needed? | Yes \\| maybe |");
    expect(r.lost).toEqual([]);
    const merged = storageToMarkdown('<table><tbody><tr><td colspan="2">wide</td></tr><tr><td>a</td><td>b</td></tr></tbody></table>');
    expect(merged.markdown).toBe("|  |  |\n| --- | --- |\n| wide |  |\n| a | b |");
    expect(merged.lost).toEqual(["A table has merged cells; they are shown as single cells."]);
  });

  it("code macros become fenced blocks (CDATA kept as it is), panels become quotes, expand macros give their content", () => {
    expect(md('<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">ts</ac:parameter><ac:plain-text-body><![CDATA[const a = 1 < 2;]]></ac:plain-text-body></ac:structured-macro>')).toBe("```ts\nconst a = 1 < 2;\n```");
    expect(md('<ac:structured-macro ac:name="info"><ac:rich-text-body><p>Watch out</p></ac:rich-text-body></ac:structured-macro>')).toBe("> **Info:** Watch out");
    expect(md('<ac:structured-macro ac:name="expand"><ac:parameter ac:name="title">More</ac:parameter><ac:rich-text-body><p>Hidden text</p></ac:rich-text-body></ac:structured-macro>')).toBe("Hidden text");
    // a language that is not a plain word is dropped, a literal fence inside code is not closed early
    expect(md('<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">&quot;&gt;&lt;x</ac:parameter><ac:plain-text-body><![CDATA[```\nx]]></ac:plain-text-body></ac:structured-macro>')).toBe("````\n```\nx\n````");
  });

  it("task lists, status lozenges, Jira issues, page links and dates", () => {
    expect(md('<ac:task-list><ac:task><ac:task-status>complete</ac:task-status><ac:task-body>Done thing</ac:task-body></ac:task><ac:task><ac:task-status>incomplete</ac:task-status><ac:task-body>Open thing</ac:task-body></ac:task></ac:task-list>')).toBe("- [x] Done thing\n- [ ] Open thing");
    expect(md('<p>State <ac:structured-macro ac:name="status"><ac:parameter ac:name="title">IN PROGRESS</ac:parameter></ac:structured-macro> and <ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">R8P-7030</ac:parameter></ac:structured-macro></p>')).toBe("State [IN PROGRESS] and [R8P-7030]");
    expect(md('<p>See <ac:link><ri:page ri:content-title="Launch plan" /></ac:link> and <ac:link><ri:page ri:content-title="X" /><ac:plain-text-link-body><![CDATA[the plan]]></ac:plain-text-link-body></ac:link>, due <time datetime="2026-12-01" />.</p>')).toBe("See Launch plan and the plan, due 2026-12-01.");
  });

  it("says what it could not carry over: images and macros without text", () => {
    const r = storageToMarkdown('<p>Look <ac:image><ri:attachment ri:filename="chart.png" /></ac:image></p><ac:structured-macro ac:name="toc" /><ac:structured-macro ac:name="gliffy"><ac:parameter ac:name="name">x</ac:parameter></ac:structured-macro>');
    expect(r.markdown).toBe("Look (image: chart.png)");
    expect(r.lost).toEqual(["1 image could not be copied; the file name is kept as text.", "Left out (no text to copy): toc, gliffy."]);
  });

  it("raw HTML that is not understood becomes its text, never HTML; scripts and styles carry no markup into the result", () => {
    const r = md('<p>Hi <span style="color:red" onclick="x()">there</span></p><script>alert(1)</script><iframe src="https://evil.test"></iframe>');
    expect(r).not.toMatch(/<(script|iframe|span)/i);
    expect(r).not.toContain("onclick");
    expect(r.startsWith("Hi there")).toBe(true);
  });

  it("is forgiving about broken or odd input: unclosed tags, stray closers, comments, an empty page", () => {
    expect(md("<p>one<p>two</p>")).toBe("one\n\ntwo");
    expect(md("text</div></p>more")).toBe("textmore");
    expect(md("<!-- note --><p>kept</p>")).toBe("kept");
    expect(md("")).toBe("");
    expect(md("<p>a < b</p>")).toContain("a");
  });

  it("the notice that our own publish puts at the top of a page is dropped when the page is read back", () => {
    const published = pageBody("# Plan\n\nText.", { link: "https://app.example.test/x", code: "R-1" });
    expect(md(published)).toBe("# Plan\n\nText.");
  });

  it("round trip: what Product Velocity publishes reads back as the same Markdown for the common cases", () => {
    const source = "# Title\n\nSome **bold** and *italic* and `code`.\n\n- one\n- two\n  - nested\n\n1. first\n2. second\n\n| Q | A |\n| --- | --- |\n| a | b |\n\n```ts\nconst a = 1;\n```\n\n> quoted";
    expect(md(markdownToStorage(source))).toBe(source);
  });
});
