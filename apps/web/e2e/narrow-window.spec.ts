import { expect, test } from "@playwright/test";

// A narrow window gives the toolbar's overflow bar no room at all. It used to flip between "button shown" and "button gone" on every pass until React gave up
// (error 185, "Maximum update depth exceeded"), which showed "This page couldn't load" on every switch between the main tabs (Ashu, 2026-11-17).
for (const width of [500, 600, 680]) {
  test(`a ${width}px window loads the grid and its toolbar without an update loop`, async ({ page }) => {
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(e.message));
    page.on("console", (m) => { if (/Maximum update depth|Minified React error #185/.test(m.text())) problems.push(m.text().slice(0, 120)); });
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/dev/grid?n=8&role=admin");
    await page.waitForSelector(".ag-row");
    await page.waitForTimeout(800);
    expect(problems).toEqual([]);
    await expect(page.getByText("This page couldn’t load")).toHaveCount(0);
  });
}
