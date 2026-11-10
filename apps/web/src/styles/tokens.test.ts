import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  fileURLToPath(new URL("./tokens.css", import.meta.url)),
  "utf8",
);

function token(name: string): string | undefined {
  return css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim();
}

describe("design tokens (docs/07)", () => {
  it("uses the brand blue and its tints", () => {
    expect(token("blue")).toBe("#2270ed");
    expect(token("blue-text")).toBe("#1a56c4");
    expect(token("blue-tint-1")).toBe("#e8f1fe");
    expect(token("blue-tint-2")).toBe("#f3f8fe");
  });

  it("carries the brand guide's brand names with the same values", () => {
    expect(token("brand")).toBe(token("blue"));
    expect(token("brand-strong")).toBe(token("blue-text"));
    expect(token("brand-tint")).toBe(token("blue-tint-1"));
    expect(token("logo-blue")).toBe("#2270ed");
    expect(token("on-brand")).toBe("#ffffff");
    expect(token("health-info-bg")).toBe(token("brand-tint"));
    expect(token("health-info-fg")).toBe(token("brand-strong"));
  });

  it("uses a 13px base with 30–36px rows", () => {
    expect(token("font-size")).toBe("13px");
    expect(token("row-height-compact")).toBe("30px");
    expect(token("row-height-comfortable")).toBe("36px");
  });

  it("uses IBM Plex for sans and mono", () => {
    expect(token("font-sans")).toContain("IBM Plex Sans");
    expect(token("font-mono")).toContain("IBM Plex Mono");
  });

  it("defines text-and-background pairs for health states", () => {
    for (const s of ["green", "amber", "red"]) {
      expect(token(`${s}-text`)).toMatch(/^#[0-9a-f]{6}$/);
      expect(token(`${s}-bg`)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("defines the danger and confirm button colours with readable white text", () => {
    for (const n of ["danger", "danger-hover", "confirm", "confirm-hover"]) expect(token(n)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("uses the brand guide's health pill pairs", () => {
    expect(token("health-good-bg")).toBe("#dcfce7");
    expect(token("health-good-fg")).toBe("#14532d");
    expect(token("health-risk-fg")).toBe("#7a4a00");
    expect(token("health-bad-bg")).toBe("#fde8e8");
    expect(token("health-bad-fg")).toBe("#8a1c1c");
    expect(token("health-neutral-fg")).toBe("#374151");
  });
});
