import { expect, test } from "@playwright/test";

for (const size of [{ width: 1600, height: 900 }, { width: 800, height: 520 }]) {
  test(`the import dialog keeps its paste box inside and its buttons visible at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/dev/grid?n=20");
    await page.waitForSelector(".ag-row");
    await page.getByRole("button", { name: /^Import/ }).click();
    const dialog = page.getByRole("dialog");
    const box = dialog.locator("textarea");
    await expect(box).toBeVisible();
    expect(await box.evaluate((e) => getComputedStyle(e).resize)).toBe("vertical");
    const d = (await dialog.boundingBox())!;
    const t = (await box.boundingBox())!;
    expect(t.x).toBeGreaterThanOrEqual(d.x);
    expect(t.x + t.width).toBeLessThanOrEqual(d.x + d.width + 0.5);
    expect(t.height).toBeGreaterThanOrEqual(119);
    // dragging the handle far to the left and up cannot shrink it below the minimum or move it out
    await page.mouse.move(t.x + t.width - 4, t.y + t.height - 4);
    await page.mouse.down();
    await page.mouse.move(t.x - 300, t.y - 300);
    await page.mouse.up();
    const after = (await box.boundingBox())!;
    expect(after.height).toBeGreaterThanOrEqual(119);
    expect(Math.abs(after.width - t.width)).toBeLessThan(1);
    // Cancel stays on the screen
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeInViewport();
  });
}
