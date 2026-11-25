import { describe, expect, it } from "vitest";
import { markdownToClipboardHtml } from "./markdown-copy";

describe("markdownToClipboardHtml", () => {
  it("keeps headings and gives tables a visible grid", () => {
    const html = markdownToClipboardHtml("## Offer\n\n| A | B |\n| - | - |\n| 1 | 2 |\n");
    expect(html).toContain("<h2>Offer</h2>");
    expect(html).toContain('<table border="1"');
    expect(html).toContain("<td>1</td>");
  });
  it("never carries raw HTML, scripts or images from the text", () => {
    const html = markdownToClipboardHtml("<script>alert(1)</script>\n\n![x](https://evil.example/a.png)");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("evil.example");
  });
  it("leaves links without a target for the app they are pasted into", () => {
    const html = markdownToClipboardHtml("[a link](https://example.com)");
    expect(html).toContain('<a href="https://example.com">a link</a>');
  });
});
