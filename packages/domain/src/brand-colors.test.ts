import { describe, expect, it } from "vitest";
import { appVars, contrast, derivePalette, luminance, normalizeHex, voterVars } from "./brand-colors";

describe("brand colours", () => {
  it("normalises hex colours and refuses anything else", () => {
    expect(normalizeHex("#2270ED")).toBe("#2270ed");
    expect(normalizeHex("27e")).toBe("#2277ee");
    for (const bad of ["", "blue", "#12", "#1234567", "rgb(1,2,3)", null, undefined, "#ggg"]) expect(normalizeHex(bad)).toBeNull();
  });

  it("measures contrast as WCAG does", () => {
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 1);
    expect(contrast("#2270ed", "#ffffff")).toBeGreaterThan(4.5); // the Product Velocity blue, 4.6:1 on white
    expect(luminance("#000000")).toBe(0);
  });

  it("leaves a colour that already reads well alone", () => {
    const r = derivePalette("#2270ED", "#f59e0b");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.palette.brand).toBe("#2270ed");
    expect(r.palette.onBrand).toBe("#ffffff");
    expect(contrast(r.palette.brandStrong, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(r.palette.accentText, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("makes every brand colour readable: text, fills and rings meet AA, and says what it changed", () => {
    for (const colour of ["#ffeb3b", "#ffd700", "#00e5ff", "#a3e635", "#9ca3af", "#ff69b4", "#111111", "#ffffff", "#7f7f7f", "#1a56c4", "#d00000", "#0b6e4f"]) {
      const r = derivePalette(colour, colour);
      expect(r.ok, colour).toBe(true);
      if (!r.ok) continue;
      const p = r.palette;
      expect(contrast(p.onBrand, p.brand), `${colour} text on fill`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.brandStrong, "#ffffff"), `${colour} text on white`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.brandStrong, p.brandTint), `${colour} text on tint`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.ring, "#ffffff"), `${colour} ring`).toBeGreaterThanOrEqual(3);
      expect(contrast(p.accentText, "#ffffff"), `${colour} accent text`).toBeGreaterThanOrEqual(4.5);
    }
    const pale = derivePalette("#ffeb3b");
    if (pale.ok) { expect(["#111827", "#000000"]).toContain(pale.palette.onBrand); expect(pale.palette.notes.length).toBeGreaterThan(0); expect(pale.palette.notes.join(" ")).toContain("#ffeb3b"); }
  });

  it("uses the main colour as the accent when none is given, and rejects invalid input with a reason", () => {
    const r = derivePalette("#0b6e4f");
    expect(r.ok && r.palette.accent).toBe("#0b6e4f");
    expect(derivePalette("green")).toEqual({ ok: false, error: "The main colour must be a hex colour such as #2270ED." });
    expect(derivePalette("#0b6e4f", "nope")).toEqual({ ok: false, error: "The accent colour must be a hex colour such as #F59E0B." });
  });

  it("maps to the variables the screens read; the app also gets the older names", () => {
    const r = derivePalette("#0b6e4f");
    if (!r.ok) throw new Error("expected ok");
    expect(Object.keys(voterVars(r.palette)).sort()).toEqual(["--brand", "--brand-ring", "--brand-strong", "--brand-tint", "--on-brand"]);
    const app = appVars(r.palette);
    expect(app["--blue"]).toBe(r.palette.brand);
    expect(app["--blue-text"]).toBe(r.palette.brandStrong);
    expect(Object.keys(app)).toEqual(expect.arrayContaining(["--blue-tint-1", "--blue-tint-2", "--brand"]));
  });
});
