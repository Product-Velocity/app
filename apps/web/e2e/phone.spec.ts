import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test.describe("initiatives on a phone", () => {
  test("search, quick filters, grouping and collapse", async ({ page }) => {
    await page.goto("/dev/phone?n=40");
    await expect(page.locator(".phone-card").first()).toBeVisible();
    await expect(page.locator(".phone-count")).toContainText("40 initiatives");
    await page.getByLabel("Search initiatives").fill("R-07");
    await expect(page.locator(".phone-card")).toHaveCount(1);
    await page.getByRole("button", { name: "Clear" }).click();
    await page.getByRole("button", { name: "Build", exact: true }).click();
    const n = await page.locator(".phone-card").count();
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(40);
    await expect(page.locator(".phone-group")).toHaveCount(1);
    await page.locator(".phone-group button").click();
    await expect(page.locator(".phone-card")).toHaveCount(0);
  });

  test("a card shows the health as a word and has a 44 px touch target", async ({ page }) => {
    await page.goto("/dev/phone?n=10");
    const c = page.locator(".phone-card").first();
    await expect(c.locator(".phone-health")).not.toBeEmpty();
    expect((await c.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("passes the accessibility check", async ({ page }) => {
    await page.goto("/dev/phone?n=10");
    await page.waitForSelector(".phone-card");
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations).toEqual([]);
  });
});
