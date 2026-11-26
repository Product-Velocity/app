import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("Help: People, roles and access", () => {
  test("explains the three kinds of people, the roles and the use-cases", async ({ page }) => {
    await page.goto("/help/people-and-access");
    await expect(page.getByRole("heading", { level: 1, name: "People, roles and access" })).toBeVisible();
    const kinds = page.getByRole("table", { name: "Participants, people not invited yet, and members" });
    await expect(kinds.getByRole("columnheader", { name: "Participant" })).toBeVisible();
    await expect(kinds.getByRole("columnheader", { name: "Person not invited yet" })).toBeVisible();
    await expect(kinds.getByRole("columnheader", { name: "Member" })).toBeVisible();
    await expect(page.getByRole("table", { name: "What each role can and cannot do" }).getByRole("rowheader", { name: "Leadership viewer" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Common cases, and what to do" }).getByRole("rowheader", { name: "Name a product manager who has no account yet" })).toBeVisible();
    await page.screenshot({ path: "../../docs/screenshots/help-people-and-access.png", fullPage: true });
  });

  test("is in the Help menu and on the Help home", async ({ page }) => {
    await page.goto("/help");
    await page.getByRole("link", { name: "People, roles and access" }).first().click();
    await expect(page).toHaveURL(/\/help\/people-and-access$/);
  });

  test("has no accessibility violations, and fits a phone without sideways scrolling", async ({ page }) => {
    await page.goto("/help/people-and-access");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/help/people-and-access");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
