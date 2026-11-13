import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PILLS } from "./brand-logo";
import { Loading, PillLoader } from "./pill-loader";

const css = readFileSync(fileURLToPath(new URL("../styles/globals.css", import.meta.url)), "utf8");

describe("Rank pill loader (brand guide, Loading and sync, 2026-11-13)", () => {
  it("is the logo's fifteen pills, no tile, in the fixed logo blue", () => {
    const svg = renderToStaticMarkup(h(PillLoader));
    expect(svg.match(/<rect/g)).toHaveLength(15);
    expect(PILLS).toHaveLength(15);
    expect(svg).toContain('fill="#2270ED"');
    expect(svg).not.toContain('rx="50"');
  });

  it("is white on a brand button and never any other colour", () => {
    const svg = renderToStaticMarkup(h(PillLoader, { tone: "white" }));
    expect(svg.match(/fill="#ffffff"/g)).toHaveLength(15);
  });

  it("lights the pills in reading order, one index each, and is hidden from screen readers", () => {
    const svg = renderToStaticMarkup(h(PillLoader));
    expect([...svg.matchAll(/--i:(\d+)/g)].map((m) => Number(m[1]))).toEqual(Array.from({ length: 15 }, (_, i) => i));
    expect(svg).toContain('aria-hidden="true"');
  });

  it("always shows a word, announced as a status", () => {
    const html = renderToStaticMarkup(h(Loading, null, "Loading the roadmap…"));
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading the roadmap…");
  });

  it("animates only opacity: 1.5 s loop, 90 ms apart, 22% to 100%, 300 ms before it shows, still with reduced motion", () => {
    expect(css).toMatch(/\.pill-loader rect \{[^}]*opacity: \.22;[^}]*animation: pv-rank 1\.5s ease-in-out infinite;[^}]*calc\(var\(--i\) \* 90ms\)/);
    expect(css).toContain("@keyframes pv-rank { 0%, 30%, 100% { opacity: .22; } 12% { opacity: 1; } }");
    expect(css.match(/@keyframes pv-rank.*/)![0]).not.toMatch(/transform|rotate|scale/);
    expect(css).toMatch(/\.pv-loading \{[^}]*animation: pv-loading-in 1ms linear 300ms forwards/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.pill-loader rect \{ animation: none; opacity: 1; \} \}/);
  });

  it("is the only looping animation left (the old spinner is gone)", () => {
    expect(css).not.toContain("pv-spin");
    expect([...css.matchAll(/animation:[^;]*infinite/g)]).toHaveLength(1);
  });
});
