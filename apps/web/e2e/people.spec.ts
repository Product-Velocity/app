import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("Not invited yet (Members)", () => {
  test("lists people named before they have an account, with how many initiatives name them", async ({ page }) => {
    await page.goto("/dev/people");
    await expect(page.getByRole("heading", { name: "Not invited yet" })).toBeVisible();
    const jane = page.locator("tr", { hasText: "Jane Doe" });
    await expect(jane).toContainText("Not invited");
    await expect(jane).toContainText("3 initiatives");
    await expect(page.locator("tr", { hasText: "Mika Aalto" })).toContainText("no initiative");
    await page.screenshot({ path: "../../docs/screenshots/people-not-invited.png" });
  });

  test("adds a person with a name only: nothing is sent", async ({ page }) => {
    await page.goto("/dev/people");
    await page.getByLabel("Name", { exact: true }).fill("Ines Vega");
    await page.getByRole("button", { name: "Add person" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Added Ines Vega. Nothing was sent." })).toBeVisible();
    await expect(page.locator("tr", { hasText: "Ines Vega" })).toContainText("none yet");
  });

  test("a repeated address is refused with the reason", async ({ page }) => {
    await page.goto("/dev/people");
    await page.getByLabel("Name", { exact: true }).fill("Another Jane");
    await page.getByLabel("Email (optional)").fill("JANE@meridian.test");
    await page.getByRole("button", { name: "Add person" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Someone with that email is on the list already" })).toBeVisible();
  });

  test("Invite opens the usual two-step review, with the address filled in and nothing sent yet", async ({ page }) => {
    await page.goto("/dev/people");
    await page.getByRole("button", { name: "Invite Jane Doe" }).click();
    const region = page.getByRole("region", { name: "Invite Jane Doe" });
    await expect(region.getByLabel("Email")).toHaveValue("jane@meridian.test");
    await region.getByRole("button", { name: "Review invitation" }).click();
    await expect(region.getByText("Review before anything is sent.")).toBeVisible();
    await expect(region.getByRole("button", { name: "Send invitation email" })).toBeVisible();
  });

  test("a person who joined with another email is linked to that member and leaves the list", async ({ page }) => {
    await page.goto("/dev/people");
    await page.getByRole("button", { name: "Ravi Rao joined with another email" }).click();
    await page.getByLabel("Ravi Rao joined as").selectOption({ label: "omar@meridian.test" });
    await page.getByRole("button", { name: "Link", exact: true }).click();
    await expect(page.locator("tr", { hasText: "Ravi Rao" })).toHaveCount(0);
  });

  test("has no accessibility violations", async ({ page }) => {
    await page.goto("/dev/people");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });
});
