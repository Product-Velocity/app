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
});
