import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicDocument } from "./public-document";

const html = (body: string) => renderToStaticMarkup(createElement(PublicDocument, { title: "PRD: Brief", kind: "prd", status: "approved", version: 2, body, updatedAt: "2026-11-06T09:00:00Z" }));

describe("the public page of a shared document", () => {
  it("shows the title, kind, status, version and the text", () => {
    const h = html("# Goal\n\nShip **it**.");
    expect(h).toContain("PRD: Brief");
    expect(h).toContain("PRD · Approved · version 2 · updated 2026-11-06");
    expect(h).toContain("<strong>it</strong>");
  });
  it("treats the text as data: no HTML, no scripts, no images; links leave without telling where they came from", () => {
    const h = html('<script>alert(1)</script><img src="https://evil.test/p.png" onerror="x()">\n\n![pixel](https://evil.test/p.png)\n\n[go](https://example.test/a)\n\n[bad](javascript:alert(1))');
    expect(h).not.toContain("<script");
    expect(h).not.toContain("<img");
    expect(h).not.toContain("evil.test");
    expect(h).not.toContain("javascript:");
    expect(h).toContain('rel="noopener noreferrer nofollow"');
    expect(h).toContain("[image: pixel]");
  });
  it("says so when there is no text", () => {
    expect(html("  ")).toContain("This document has no text yet.");
  });
});
