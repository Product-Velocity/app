import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");
// every main-tab page builds its header with PageHeader, so the area under the tabs cannot drift apart again
const PAGES = [
  "features/portfolio/portfolio-grid.tsx",
  "features/gantt/gantt-view.tsx",
  "features/cards/cards-view.tsx",
  "features/leadership/leadership-view.tsx",
  "features/alignment/alignment-list.tsx",
  "features/attention/attention-view.tsx",
  "features/gates/decisions-view.tsx",
  "features/reports/reports-view.tsx",
];

describe("page header", () => {
  it.each(PAGES)("%s uses PageHeader and has no hand-made page-head", (file) => {
    const src = readFileSync(join(SRC, file), "utf8");
    expect(src).toContain("<PageHeader");
    expect(src).not.toMatch(/className="[^"]*\bpage-head\b/);
  });
});
