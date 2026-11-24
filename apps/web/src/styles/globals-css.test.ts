import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "globals.css"), "utf8");

/** These rules were lost once in a merge, and the Description hover card then showed up huge and unstyled behind the grid. */
describe("Description cell and hover card styles", () => {
  it.each([
    ".md-tooltip {",
    ".md-tooltip .md-preview {",
    ".ag-cell .cell-text {",
    ".ag-cell .cell-text-fade {",
  ])("keeps %s", (rule) => {
    expect(css).toContain(rule);
  });
  it("sizes the hover card", () => {
    expect(css).toMatch(/\.md-tooltip \{[^}]*max-width: 520px[^}]*max-height: 360px/);
  });
});

/**
 * The search field in the grid bar must have one frame (the bar's own). The global input rule `input:not(..):not(..):not(..)` has specificity (0,3,1), so
 * the bar's rule has to be at least as specific, or the global border is drawn again inside the bar (it came back once).
 */
describe("search field in the bar has no second frame", () => {
  const specificity = (sel: string) => {
    const ids = (sel.match(/#[\w-]+/g) ?? []).length;
    const classes = (sel.match(/\.[\w-]+|\[[^\]]*\]/g) ?? []).length; // classes and attributes, also inside :not(), which counts as its argument
    const types = (sel.replace(/\[[^\]]*\]/g, "").match(/(^|[\s>+~])[a-z][\w-]*/g) ?? []).length;
    return [ids, classes, types];
  };
  const selectorOf = (start: string) => {
    const line = css.split("\n").find((l) => l.startsWith(start));
    expect(line, `a rule starting with ${start}`).toBeTruthy();
    return line!.slice(0, line!.indexOf("{")).trim();
  };
  it("outranks the global input rule", () => {
    const [, gc] = specificity(selectorOf('input:not([type="checkbox"])'));
    const [, lc] = specificity(selectorOf(".pvbar-search input[type=\"search\"]"));
    expect(lc ?? 0).toBeGreaterThanOrEqual(gc ?? 0);
  });
  it("removes the border and the focus ring of the input (the label draws them)", () => {
    expect(css).toMatch(/\.pvbar-search input\[type="search"\][^{]*\{ border: 0; outline: 0;/);
  });
});
