import { describe, expect, it } from "vitest";
import { commercialWarnings, inline, managedBanner, markdownToStorage, pageBody, pageIdFromUrl, planPublish } from "./confluence";

describe("Markdown to Confluence storage format", () => {
  it("headings, paragraphs, emphasis, code spans and links", () => {
    expect(markdownToStorage("# Title\n\nSome **bold**, _italic_, `code` and ~~gone~~ text.\nSecond line of the paragraph.\n\n## Sub"))
      .toBe("<h1>Title</h1><p>Some <strong>bold</strong>, <em>italic</em>, <code>code</code> and <del>gone</del> text. Second line of the paragraph.</p><h2>Sub</h2>");
    expect(inline("see [the spec](https://example.test/a?b=1&c=2) now")).toBe('see <a href="https://example.test/a?b=1&amp;c=2">the spec</a> now');
  });

  it("raw HTML is shown as text, never passed on, and unsafe link targets lose their link", () => {
    expect(markdownToStorage("<script>alert(1)</script> & <b>x</b>")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;x&lt;/b&gt;</p>");
    expect(inline("[x](javascript:alert(1))")).toBe("x");
    expect(inline("[x](data:text/html;base64,AAAA)")).toBe("x");
    expect(inline('[x](https://a.test/"onmouseover="y)')).not.toContain("onmouseover=");
    expect(inline("[mail](mailto:a@b.test)")).toBe('<a href="mailto:a@b.test">mail</a>');
  });

  it("underscores inside words are not emphasis, and code spans are not formatted", () => {
    expect(inline("use snake_case_name here")).toBe("use snake_case_name here");
    expect(inline("`**not bold**`")).toBe("<code>**not bold**</code>");
  });

  it("an image is published as its text (images come later)", () => {
    expect(inline("![diagram](https://example.test/d.png)")).toBe("diagram (https://example.test/d.png)");
  });

  it("lists: unordered, ordered, nested, task items and a blank line between items", () => {
    expect(markdownToStorage("- one\n- two\n  - nested\n- three")).toBe("<ul><li>one</li><li>two<ul><li>nested</li></ul></li><li>three</li></ul>");
    expect(markdownToStorage("1. first\n2. second")).toBe("<ol><li>first</li><li>second</li></ol>");
    expect(markdownToStorage("- [ ] todo\n- [x] done")).toBe("<ul><li>☐ todo</li><li>☑ done</li></ul>");
    expect(markdownToStorage("- a\n\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
  });

  it("code blocks become the code macro; a literal ]]> cannot end the section early", () => {
    const html = markdownToStorage("```ts\nconst a = 1 < 2;\n```");
    expect(html).toBe('<ac:structured-macro ac:name="code" ac:schema-version="1"><ac:parameter ac:name="language">ts</ac:parameter><ac:plain-text-body><![CDATA[const a = 1 < 2;]]></ac:plain-text-body></ac:structured-macro>');
    expect(markdownToStorage("```\nx ]]> y\n```")).toContain("<![CDATA[x ]]]]><![CDATA[> y]]>");
    // a language that is not a plain word is dropped, not injected
    expect(markdownToStorage('```"><x\nq\n```')).not.toContain("ac:parameter");
    // an unclosed fence runs to the end of the text
    expect(markdownToStorage("```\nopen")).toContain("<![CDATA[open]]>");
  });

  it("tables, block quotes and rules", () => {
    expect(markdownToStorage("| Question | Answer |\n| --- | --- |\n| GTM needed? | Yes |\n| Audience | Mixed |"))
      .toBe("<table><tbody><tr><th>Question</th><th>Answer</th></tr><tr><td>GTM needed?</td><td>Yes</td></tr><tr><td>Audience</td><td>Mixed</td></tr></tbody></table>");
    expect(markdownToStorage("| a | b |\n|---|---|\n| only one |")).toContain("<td>only one</td><td></td>");
    expect(markdownToStorage("> quoted **text**\n> more\n\n---")).toBe("<blockquote><p>quoted <strong>text</strong> more</p></blockquote><hr/>");
  });

  it("a heading directly after a paragraph starts a new block, and an empty document gives an empty body", () => {
    expect(markdownToStorage("text\n# Head")).toBe("<p>text</p><h1>Head</h1>");
    expect(markdownToStorage("")).toBe("");
  });

  it("the page starts with the notice that it is managed in Product Velocity, with a link only when it is a https address", () => {
    expect(managedBanner()).toContain("Managed in Product Velocity");
    expect(managedBanner({ link: "https://app.example.test/x?item=R-1&tab=spec", code: "R-1" })).toContain('<a href="https://app.example.test/x?item=R-1&amp;tab=spec">Open R-1 in Product Velocity</a>');
    expect(managedBanner({ link: "javascript:alert(1)" })).not.toContain("<a ");
    expect(pageBody("hi").startsWith("<ac:structured-macro")).toBe(true);
    expect(pageBody("hi").endsWith("<p>hi</p>")).toBe(true);
  });
});

describe("the warning about commercial text", () => {
  const terms = [
    { kind: "customer" as const, label: "Customer: Acme Corp", text: "Acme Corp" },
    { kind: "key_result" as const, label: "Key result", text: "Reduce churn to 4%" },
    { kind: "value" as const, label: "Business value", text: "1,200,000" },
  ];
  it("lists the customer names, key results and value it finds, and any amount of money", () => {
    const w = commercialWarnings("Acme Corp asked for this. Goal: reduce churn to 4%.\nWorth about €1.2m a year, 50k EUR to build.", terms);
    expect(w).toEqual(expect.arrayContaining([
      { kind: "customer", what: "Customer: Acme Corp" }, { kind: "key_result", what: "Key result" },
      { kind: "money", what: "€1.2m" }, { kind: "money", what: "50k EUR" },
    ]));
    expect(w.find((x) => x.kind === "value")).toBeUndefined();
  });
  it("says nothing about a document without commercial text, ignores very short terms, and lists each once", () => {
    expect(commercialWarnings("A plain description of the screen.", terms)).toEqual([]);
    expect(commercialWarnings("It is ok", [{ kind: "customer", label: "x", text: "ok" }])).toEqual([]);
    expect(commercialWarnings("$5 and $5 and $5", [])).toEqual([{ kind: "money", what: "$5" }]);
  });
});

describe("page addresses", () => {
  it("reads the page id from the usual addresses and nothing else", () => {
    expect(pageIdFromUrl("https://acme.atlassian.net/wiki/spaces/PRD/pages/123456/My+Page")).toBe("123456");
    expect(pageIdFromUrl("https://acme.atlassian.net/wiki/spaces/PRD/pages/123456")).toBe("123456");
    expect(pageIdFromUrl("https://acme.atlassian.net/wiki/pages/viewpage.action?pageId=98765")).toBe("98765");
    expect(pageIdFromUrl("https://acme.atlassian.net/wiki/x/AbCdEf")).toBeNull();
    expect(pageIdFromUrl("http://acme.atlassian.net/wiki/spaces/PRD/pages/123")).toBeNull();
    expect(pageIdFromUrl("not a url")).toBeNull();
    expect(pageIdFromUrl("https://acme.atlassian.net/wiki/spaces/PRD/pages/abc")).toBeNull();
  });
});

describe("what a publish does", () => {
  const published = { pageId: "1", publishedVersion: 2, remoteVersion: 5, contentHash: "h1" };
  it("creates a page when the document was never published", () => {
    expect(planPublish({ published: null, docVersion: 1, bodyHash: "h", remote: null }).action).toBe("create");
  });
  it("has nothing to send when the page already holds this version built the same way", () => {
    expect(planPublish({ published, docVersion: 2, bodyHash: "h1", remote: { id: "1", version: 5, title: "T" } }).action).toBe("none");
  });
  it("updates when the document moved on, or when the same version is built differently", () => {
    expect(planPublish({ published, docVersion: 3, bodyHash: "h2", remote: { id: "1", version: 5, title: "T" } })).toMatchObject({ action: "update", why: expect.stringContaining("version 3") });
    expect(planPublish({ published, docVersion: 2, bodyHash: "other", remote: { id: "1", version: 5, title: "T" } }).action).toBe("update");
  });
  it("is a conflict when the page was saved in Confluence after our last write, and says which versions", () => {
    const r = planPublish({ published, docVersion: 3, bodyHash: "h2", remote: { id: "1", version: 7, title: "T" } });
    expect(r.action).toBe("conflict");
    expect(r.why).toContain("version 7");
    expect(r.why).toContain("version 5");
  });
  it("says when the page is gone", () => {
    expect(planPublish({ published, docVersion: 3, bodyHash: "h2", remote: "missing" }).action).toBe("gone");
  });
  it("without a remote answer it plans from what is stored", () => {
    expect(planPublish({ published, docVersion: 3, bodyHash: "h2", remote: null }).action).toBe("update");
  });
});
