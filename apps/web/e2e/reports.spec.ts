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
const rowsShown = (page: Page) => page.locator(".rp-table tbody tr");

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
  await expect(page.getByText("No data matching current filters")).toHaveCount(5);
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
