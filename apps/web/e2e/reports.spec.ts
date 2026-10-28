import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** The harness has 42 items (item i, counting from 0): phase cycles Discover, Define, Build, Beta-test; every seventh from the 7th is archived. */
const N = 42;
const items = Array.from({ length: N }, (_, i) => ({ i, phase: ["Discover", "Define", "Build", "Beta-test"][i % 4]!, archived: i % 7 === 6, quarter: ["Q3 2027", "Q4 2027", null][i % 3] ?? null, core: i % 5 === 0 || i % 2 === 0 }));
const live = items.filter((x) => !x.archived);

const open = async (page: Page, query = "") => {
  await page.goto(`/dev/reports?n=${N}${query}`);
  await page.waitForSelector(".reports");
};
const summary = (page: Page) => page.locator(".page-head [role=status]");
const rowsShown = (page: Page) => page.locator('section[aria-label="Initiatives"] .rp-table tbody tr');

test("shows every live initiative, archived ones only with the toggle", async ({ page }) => {
  await open(page);
  await expect(summary(page)).toHaveText(`${live.length} of ${N} initiatives`);
  await expect(rowsShown(page)).toHaveCount(live.length);
  await page.getByLabel("Include archived").check();
  await expect(rowsShown(page)).toHaveCount(N);
});

test("the filter bar narrows every chart and the grid, and shows a count badge", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /^Initiative Phase/ }).click();
  await page.getByRole("checkbox", { name: "Build" }).check();
  const build = live.filter((x) => x.phase === "Build").length;
  await expect(rowsShown(page)).toHaveCount(build);
  await expect(page.getByRole("button", { name: /^Initiative Phase/ })).toContainText("1");
  // the Product Manager x Phase chart now has a Build segment only
  await expect(page.locator('section[aria-label="Initiatives by Product Manager and Phase"] .rp-legend-item')).toHaveText(["Build"]);
  await page.getByRole("button", { name: "Reset filters" }).click();
  await expect(rowsShown(page)).toHaveCount(live.length);
});

test("clicking a segment adds pills, clicking it again removes them, and the address keeps the drill-down", async ({ page }) => {
  await open(page);
  const chart = page.locator('section[aria-label="Initiatives by Product Manager and Phase"]');
  const seg = chart.locator(".rp-seg").first();
  const label = (await seg.getAttribute("aria-label"))!; // "ana@example.test, Discover: 3"
  const count = Number(label.split(": ")[1]);
  await seg.click();
  await expect(page.locator(".rp-pill")).toHaveCount(2);
  await expect(rowsShown(page)).toHaveCount(count);
  await expect(page).toHaveURL(/[?&]d=/);
  // a copied address shows the same drill-down
  const url = page.url();
  await page.goto(url);
  await page.waitForSelector(".reports");
  await expect(page.locator(".rp-pill")).toHaveCount(2);
  await expect(rowsShown(page)).toHaveCount(count);
  await page.locator('section[aria-label="Initiatives by Product Manager and Phase"] .rp-seg-on').click();
  await expect(page.locator(".rp-pill")).toHaveCount(0);
  await expect(rowsShown(page)).toHaveCount(live.length);
});

test("Planned Quarter filter keeps Unscheduled apart and full year selects the four quarters", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /^Planned Quarter/ }).click();
  await page.getByRole("checkbox", { name: "Unscheduled" }).check();
  await expect(rowsShown(page)).toHaveCount(live.filter((x) => x.quarter === null).length);
  await page.getByRole("checkbox", { name: "Unscheduled" }).uncheck();
  await page.getByRole("button", { name: "Full year 2027" }).click();
  for (const q of ["Q1", "Q2", "Q3", "Q4"]) await expect(page.getByRole("checkbox", { name: `${q} 2027` })).toBeChecked();
  await expect(rowsShown(page)).toHaveCount(live.filter((x) => x.quarter !== null).length);
});

test("a multi-team initiative counts once per team and the chart says so", async ({ page }) => {
  await open(page);
  const chart = page.locator('section[aria-label="Initiatives by Group and Team"]');
  await expect(chart.locator(".rp-note")).toContainText("once per team");
  const mobile = live.filter((x) => x.i % 5 === 0).length;
  const labels = await chart.locator(".rp-seg").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!));
  const sum = labels.filter((l) => l.includes(", Mobile: ")).reduce((n, l) => n + Number(l.split(": ").pop()), 0);
  expect(sum).toBe(mobile);
});

test("no matches shows the empty message in every module and keeps the layout", async ({ page }) => {
  await open(page, "&f.initiative_phase=Build&d=initiative_phase:Discover");
  await expect(page.getByText("No data matching current filters")).toHaveCount(10);
  await expect(page.getByRole("button", { name: "Reset filters" })).toBeEnabled();
});

test("CSV has exactly the filtered rows and no commercial column", async ({ page }) => {
  await open(page, "&f.initiative_phase=Build");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /^Export CSV/ }).click()]);
  const text = (await (await import("node:fs/promises")).readFile((await download.path())!, "utf8")).replace(/^﻿/, "");
  const lines = text.trim().split(/\r?\n/);
  expect(lines.length - 1).toBe(live.filter((x) => x.phase === "Build").length);
  expect(lines[0]).toContain("Initiative Name");
  expect(lines[0]).not.toMatch(/Value|Confidence|Decision|Customer/);
});

test("keyboard: a segment is reachable and Enter filters", async ({ page }) => {
  await open(page);
  await page.locator(".rp-seg").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".rp-pill").first()).toBeVisible();
});

test("has no accessibility violations", async ({ page }) => {
  await open(page);
  const r = await new AxeBuilder({ page }).include(".reports").analyze();
  expect(r.violations.map((v) => v.id + ": " + v.nodes.map((n) => n.target).join(" | "))).toEqual([]);
});

// ---- step 2: Time to Market and the timeline
/** Discovery starts on day i; Start Date is 5 days later; every third item went to market 60 + (i % 4) * 10 days after discovery. */
const done = live.filter((x) => x.i % 3 === 0).map((x) => 60 + (x.i % 4) * 10);
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const kpi = (page: Page, name: string) => page.locator(`[data-kpi="${name}"]`);
type ChartsWindow = { __charts: Record<string, { convertToPixel: (f: object, v: unknown) => number | number[] }> };
/** Click where the chart draws a value: its pixel position inside the chart box. */
const clickAt = async (page: Page, chart: string, finder: object, value: unknown) => {
  await page.locator(`[data-chart="${chart}"]`).evaluate((e) => e.scrollIntoView({ block: "start" })); // a tall chart: its first line must be on screen
  const px = await page.evaluate(([c, f, v]) => (window as unknown as ChartsWindow).__charts[c as string]!.convertToPixel(f as object, v), [chart, finder, value] as const);
  const box = (await page.locator(`[data-chart="${chart}"]`).boundingBox())!;
  const [x, y] = px as number[];
  await page.mouse.click(box.x + x!, box.y + y!);
};

test("Time to Market card shows median, average, how many were counted and how many were left out", async ({ page }) => {
  await open(page);
  await expect(kpi(page, "count")).toHaveText(String(done.length));
  await expect(kpi(page, "excluded")).toHaveText(String(live.length - done.length));
  await expect(kpi(page, "median")).toHaveText(String(Math.round(med(done) * 10) / 10));
  await expect(kpi(page, "average")).toHaveText(String(Math.round((done.reduce((a, b) => a + b, 0) / done.length) * 10) / 10));
});

test("the dots table lists exactly the counted initiatives", async ({ page }) => {
  await open(page);
  const scatter = page.locator('[data-chart="ttm-scatter"]').locator("xpath=following-sibling::details");
  await scatter.locator("summary").click();
  await expect(scatter.locator("tbody tr")).toHaveCount(done.length);
});

test("Time to Market follows the filters and shows the empty message when nothing is left", async ({ page }) => {
  await open(page, "&f.initiative_phase=Build");
  const builds = live.filter((x) => x.phase === "Build" && x.i % 3 === 0).map((x) => 60 + (x.i % 4) * 10);
  await expect(kpi(page, "count")).toHaveText(String(builds.length));
  await open(page, "&f.initiative_phase=Build&d=initiative_phase:Discover");
  await expect(page.getByText("No data matching current filters")).toHaveCount(10);
});

test("clicking a team bar filters everything like the other charts", async ({ page }) => {
  await open(page);
  await clickAt(page, "ttm-team", { xAxisIndex: 0, yAxisIndex: 0 }, [5, "Core"]);
  const pill = page.locator(".rp-pill");
  await expect(pill).toHaveText(/Team: Core/);
  await expect(rowsShown(page)).toHaveCount(live.filter((x) => x.core).length);
  await pill.click();
  await expect(pill).toHaveCount(0);
});

test("clicking a dot opens the initiative", async ({ page }) => {
  await open(page);
  await page.locator('[data-chart="ttm-scatter"]').scrollIntoViewIfNeeded();
  const first = done.length > 0 ? live.find((x) => x.i % 3 === 0)! : null;
  const end = Date.UTC(2027, 1, 1) + (first!.i + 60 + (first!.i % 4) * 10) * 86_400_000;
  await clickAt(page, "ttm-scatter", { xAxisIndex: 0, yAxisIndex: 0 }, [end, 60 + (first!.i % 4) * 10]);
  await expect(page.getByTestId("item-panel")).toContainText("R-01");
});

test("timeline: pages in 30 at a time, switches scale and colour, and opens an initiative from a bar", async ({ page }) => {
  await open(page);
  const t = page.locator('section[aria-label="Timeline"]');
  await expect(t).toContainText(`Showing 30 of ${live.length} initiatives with dates`);
  await expect(t.locator(".rp-legend-item")).toContainText(["Discover", "Define", "Build"]);
  await t.getByRole("button", { name: "Colour by Health" }).click();
  await expect(t.locator(".rp-legend-item")).toContainText(["On Track"]);
  await t.getByRole("button", { name: "Quarters" }).click();
  await expect(t.getByRole("button", { name: "Quarters" })).toHaveAttribute("aria-pressed", "true");
  await t.getByRole("button", { name: /^Show \d+ more/ }).click();
  await expect(t).toContainText(`Showing ${live.length} of ${live.length}`);
  await clickAt(page, "timeline", { xAxisIndex: 0, yAxisIndex: 0 }, [Date.UTC(2027, 1, 5), 0]);
  await expect(page.getByTestId("item-panel")).toContainText("R-01");
});

// ---- step 3: Impact and Effort (version 1, with a placeholder for achieved impact)
test("Impact and Effort says how many initiatives have no Primary KR, and holds a placeholder for achieved impact", async ({ page }) => {
  await open(page);
  const withKr = live.filter((x) => x.i % 4 === 0).length;
  await expect(page.locator('[data-kpi="no-kr"]')).toHaveText(String(live.length - withKr));
  const t = page.locator('section[aria-label="Impact and Effort"]');
  await expect(t.getByTestId("impact-placeholder")).toContainText("phase 7");
  await expect(t.getByTestId("impact-placeholder")).toContainText("nothing here is estimated");
  await expect(t.getByRole("table", { name: "Primary KRs" }).locator("tbody tr")).toHaveCount(Math.min(15, withKr));
  await expect(page.getByRole("button", { name: /^PDF summary/ })).toBeDisabled();
});

test("clicking an effort bar filters like the other charts, and the KR note follows the filters", async ({ page }) => {
  await open(page);
  await clickAt(page, "impact-effort", { xAxisIndex: 0, yAxisIndex: 0 }, ["XS", 1]);
  await expect(page.locator(".rp-pill")).toHaveText(/Effort: XS/);
  await expect(rowsShown(page)).toHaveCount(live.filter((x) => x.i % 5 === 0).length);
  await expect(page.locator('[data-kpi="no-kr"]')).toHaveText(String(live.filter((x) => x.i % 5 === 0 && x.i % 4 !== 0).length));
});

// ---- step 4: overview donuts, Team by Phase, percent view, Engineering Manager
const em = (i: number) => (i % 6 === 0 ? null : `u${(i % 5) + 1}`);

test("Engineering Manager filters the list like Product Manager and is a column", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /^Engineering Manager/ }).click();
  await page.getByRole("checkbox", { name: "ana@example.test" }).check();
  await expect(rowsShown(page)).toHaveCount(live.filter((x) => em(x.i) === "u1").length);
  await expect(page.getByRole("columnheader", { name: "Engineering Manager" })).toBeVisible();
  await page.getByRole("checkbox", { name: "ana@example.test" }).uncheck();
  await page.getByRole("checkbox", { name: "No Engineering Manager" }).check();
  await expect(rowsShown(page)).toHaveCount(live.filter((x) => em(x.i) === null).length);
});

test("the overview draws a donut for each field with more than one value and names the single-valued ones", async ({ page }) => {
  await open(page);
  const o = page.locator('section[aria-label="Overview"]');
  await expect(o.locator('[data-chart^="donut-"]')).toHaveCount(4); // status, phase, team, MoSCoW; Focus Area is empty everywhere
  await expect(o).toContainText(`Focus Area: Not set (all ${live.length})`);
  await o.getByText("Show as table").click();
  await expect(o.getByRole("table", { name: "Overview shares" }).locator("tbody tr").first()).toBeVisible();
});

test("clicking a donut slice filters like any other chart", async ({ page }) => {
  await open(page);
  const chart = page.locator('[data-chart="donut-moscow"]');
  await chart.scrollIntoViewIfNeeded();
  const box = (await chart.boundingBox())!;
  const must = live.filter((x) => x.i % 4 === 0).length;
  // where ECharts drew the first slice (its own layout: screen angles, clockwise, 12 o clock is 3π/2)
  const l = await page.evaluate(() => (window as unknown as { __charts: Record<string, { getModel: () => { getSeriesByIndex: (i: number) => { getData: () => { getItemLayout: (i: number) => { cx: number; cy: number; r0: number; r: number; startAngle: number; endAngle: number } } } } }> }).__charts["donut-moscow"]!.getModel().getSeriesByIndex(0).getData().getItemLayout(0));
  const mid = (l.startAngle + l.endAngle) / 2, r = (l.r0 + l.r) / 2;
  await page.mouse.click(box.x + l.cx + r * Math.cos(mid), box.y + l.cy + r * Math.sin(mid));
  await expect(page.locator(".rp-pill")).toHaveText(/MoSCoW: Must/);
  await expect(rowsShown(page)).toHaveCount(must);
});

test("Initiatives by Team and Phase counts per team and filters on both", async ({ page }) => {
  await open(page);
  const chart = page.locator('section[aria-label="Initiatives by Team and Phase"]');
  await expect(chart.locator(".rp-note")).toContainText("once per team");
  const total = await chart.locator(".rp-seg").evaluateAll((els) => els.reduce((n, e) => n + Number(e.getAttribute("aria-label")!.split(": ").pop()), 0));
  expect(total).toBe(live.reduce((n, x) => n + (x.i % 5 === 0 ? 2 : x.i % 2 === 0 ? 1 : 1), 0)); // two teams, one team, or none (counted as "No team")
  await chart.locator(".rp-seg").first().click();
  await expect(page.locator(".rp-pill")).toHaveCount(2);
});

test("the percent view makes every bar 100%, says the share in each segment and is kept in the address", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Share of each bar (%)" }).click();
  await expect(page).toHaveURL(/pct=1/);
  const chart = page.locator('section[aria-label="Initiatives by Product Manager and Phase"]');
  await expect(chart.locator(".rp-seg").first()).toHaveText(/^\d+%$/);
  await expect(chart.locator(".rp-seg").first()).toHaveAttribute("aria-label", /: \d+ \(\d+%\)$/);
  const widths = await chart.locator(".rp-row .rp-bar").evaluateAll((els) => els.map((e) => (e as HTMLElement).style.width));
  expect(new Set(widths)).toEqual(new Set(["100%"]));
  await page.reload();
  await page.waitForSelector(".reports");
  await expect(page.getByRole("button", { name: "Share of each bar (%)" })).toHaveAttribute("aria-pressed", "true");
});
