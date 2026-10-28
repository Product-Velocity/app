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
