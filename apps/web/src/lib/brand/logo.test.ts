import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { makeLogoPng, svgIsPlain } from "./logo";

const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 34, g: 112, b: 237, alpha: 1 } } }).png().toBuffer();

describe("logo processing", () => {
  it("re-draws a PNG at a sensible size and names it by its hash", async () => {
    const r = await makeLogoPng(await png(2000, 500));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.width).toBeLessThanOrEqual(640);
    expect(r.height).toBeLessThanOrEqual(240);
    expect(r.sha).toMatch(/^[0-9a-f]{64}$/);
    expect((await sharp(r.png).metadata()).format).toBe("png");
  });
  it("keeps a small logo at its own size", async () => {
    const r = await makeLogoPng(await png(120, 40));
    expect(r.ok && [r.width, r.height]).toEqual([120, 40]);
  });
  it("accepts JPG and a plain SVG, and draws the SVG as a PNG", async () => {
    const jpg = await sharp({ create: { width: 300, height: 100, channels: 3, background: "#0b6e4f" } }).jpeg().toBuffer();
    expect((await makeLogoPng(jpg)).ok).toBe(true);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><rect width="200" height="60" fill="#0b6e4f"/></svg>');
    const r = await makeLogoPng(svg);
    expect(r.ok).toBe(true);
    if (r.ok) expect((await sharp(r.png).metadata()).format).toBe("png");
  });
  it("refuses an SVG with a script or an outside reference", async () => {
    for (const bad of [
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><image href="http://evil.test/x.png"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><image href="file:///etc/passwd"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" onload="x()"></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect style="fill:url(http://evil.test/a)"/></svg>',
    ]) {
      const r = await makeLogoPng(Buffer.from(bad));
      expect(r.ok, bad).toBe(false);
    }
    expect(svgIsPlain('<svg><defs><linearGradient id="a"/></defs><rect fill="url(#a)"/><use href="#a"/></svg>')).toBe(true);
  });
  it("refuses empty, oversized, unknown and too small files with a reason", async () => {
    expect(await makeLogoPng(new Uint8Array())).toEqual({ ok: false, error: "The file is empty." });
    expect((await makeLogoPng(new Uint8Array(1_000_001))).ok).toBe(false);
    expect((await makeLogoPng(Buffer.from("%PDF-1.4 not an image"))).ok).toBe(false);
    const tiny = await makeLogoPng(await png(8, 8));
    expect(tiny.ok).toBe(false);
  });
});
