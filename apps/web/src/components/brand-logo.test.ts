import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandLogo, BrandMark, LOGO_BLUE } from "./brand-logo";

const file = (p: string) => fileURLToPath(new URL(p, import.meta.url));

describe("brand logo (brand guide, 2026-11-10)", () => {
  it("is fifteen white pills on a rounded square in the fixed logo blue", () => {
    const svg = renderToStaticMarkup(h(BrandMark));
    expect(LOGO_BLUE).toBe("#2270ED");
    expect(svg.match(/<rect/g)).toHaveLength(16); // tile + 15 pills
    expect(svg).toContain('rx="50" fill="#2270ED"');
    expect(svg.match(/fill="#ffffff"/g)).toHaveLength(15);
  });

  it("draws the glyph without the tile, pills in logo blue", () => {
    const svg = renderToStaticMarkup(h(BrandMark, { glyph: true }));
    expect(svg.match(/<rect/g)).toHaveLength(15);
    expect(svg).not.toContain("#ffffff");
  });

  it("sets the name as live text beside the mark", () => {
    const html = renderToStaticMarkup(h(BrandLogo));
    expect(html).toContain('aria-label="Product Velocity"');
    expect(html).toMatch(/>Product Velocity<\/span>/);
  });

  it("ships the brand files: SVGs, favicon, app icons and the email logo", () => {
    for (const p of ["../../public/brand/pv-mark.svg", "../../public/brand/pv-glyph.svg", "../app/icon.svg", "../app/icon.png", "../app/apple-icon.png", "../app/favicon.ico", "../../public/brand/icon-192.png", "../../public/email/logo.png"]) {
      expect(existsSync(file(p)), p).toBe(true);
    }
    expect(readFileSync(file("../app/icon.svg"), "utf8").match(/<rect/g)).toHaveLength(16);
    expect(readFileSync(file("../../public/brand/pv-mark.svg"), "utf8")).toContain("#2270ED");
  });

  it("the Rank loader follows the brand guide: fifteen pills in logo blue, no tile, about 1.5 s, 90 ms apart in reading order, still under reduced motion, no script", () => {
    const svg = readFileSync(file("../../public/brand/pv-rank-loader.svg"), "utf8");
    expect(svg.match(/<rect /g)).toHaveLength(15); // the glyph only: no tile
    expect(svg).toContain("#2270ED");
    expect(svg).not.toMatch(/<script|onload|<image|href=/i);
    expect(svg).toMatch(/animation:rank 1\.5s ease-in-out infinite/);
    expect(svg).toMatch(/@media \(prefers-reduced-motion:reduce\)\{\.p\{animation:none;opacity:1\}\}/);
    expect(svg).toMatch(/opacity:\.22/); // 22% to 100% and back
    const delays = [...svg.matchAll(/<rect [^>]*animation-delay:([\d.]+)s[^>]*x="([\d.]+)" y="([\d.]+)"/g)].map((m) => ({ d: Number(m[1]), x: Number(m[2]), y: Number(m[3]) }));
    expect(delays).toHaveLength(15);
    // column by column, top to bottom within a column, 90 ms apart
    const byDelay = [...delays].sort((a, b) => a.d - b.d);
    expect(byDelay.map((p) => Math.round(p.d * 100))).toEqual(Array.from({ length: 15 }, (_, i) => i * 9));
    for (let i = 1; i < byDelay.length; i++) {
      const a = byDelay[i - 1]!, b = byDelay[i]!;
      expect(b.x > a.x || (b.x === a.x && b.y > a.y)).toBe(true);
    }
  });
});
