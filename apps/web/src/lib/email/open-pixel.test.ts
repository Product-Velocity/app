import { describe, expect, it } from "vitest";
import { PIXEL_GIF, injectPixel, isUuid, pixelUrl } from "./open-pixel";
import { EMAIL_TEMPLATES } from "./registry/registry";

describe("open pixel", () => {
  it("is a valid GIF", () => expect(PIXEL_GIF.subarray(0, 6).toString("ascii")).toBe("GIF89a"));
  it("only a UUID is accepted as an id", () => {
    expect(isUuid("3f2b8c1e-9a4d-4e0b-8f6a-1c2d3e4f5a6b")).toBe(true);
    for (const bad of ["", "abc", "3f2b8c1e-9a4d-4e0b-8f6a-1c2d3e4f5a6b/../x", "../../etc", 42, null]) expect(isUuid(bad), String(bad)).toBe(false);
  });
  it("builds an address with the id only", () => {
    expect(pixelUrl("https://pv.test/", "3f2b8c1e-9a4d-4e0b-8f6a-1c2d3e4f5a6b")).toBe("https://pv.test/api/e/o/3f2b8c1e-9a4d-4e0b-8f6a-1c2d3e4f5a6b");
  });
  it("adds one hidden image before the end of the page, or at the end of a page without a body tag", () => {
    const out = injectPixel("<html><body><p>Hi</p></body></html>", "https://pv.test/api/e/o/x?a=1&b=2");
    expect(out.match(/<img/g)).toHaveLength(1);
    expect(out).toContain('alt=""');
    expect(out).toContain("a=1&amp;b=2");
    expect(out.indexOf("<img")).toBeLessThan(out.indexOf("</body>"));
    expect(injectPixel("<p>Hi</p>", "https://pv.test/p")).toMatch(/<p>Hi<\/p><img/);
  });
});

describe("which emails may carry it", () => {
  const tracked = EMAIL_TEMPLATES.filter((t) => t.trackOpens).map((t) => t.key).sort();
  it("is a short, named list", () => expect(tracked).toEqual(["app.followup-personal", "app.invitation", "app.welcome-personal"]));
  it("never an email to alignment voters, and never a sign-in, confirmation or reset email", () => {
    for (const t of EMAIL_TEMPLATES) {
      if (t.key.startsWith("alignment.") || t.key.startsWith("auth.") || t.key === "app.link-code") expect(t.trackOpens, t.key).toBeFalsy();
    }
  });
});
