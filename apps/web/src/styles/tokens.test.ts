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
    expect(token("blue")).toBe("#3347d9");
    expect(token("blue-text")).toBe("#2433a8");
    expect(token("blue-tint-1")).toBe("#e8ebfd");
    expect(token("blue-tint-2")).toBe("#f4f7fe");
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
});
