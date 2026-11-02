import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("Jira connection settings (issue #67, slice A)", () => {
  test("a connected site lists its Jira projects and offers Disconnect and a second site", async ({ page }) => {
    await page.goto("/dev/jira");
    await expect(page.getByRole("heading", { name: "Jira", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Acme Corp" })).toBeVisible();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    const table = page.getByRole("table", { name: "Jira projects of Acme Corp" });
    await expect(table).toContainText("PLAT");
    await expect(table).toContainText("Software (team-managed)");
    await expect(table).toContainText("Product Discovery (team-managed)");
    await expect(page.getByRole("button", { name: "Disconnect Acme Corp" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect another Jira site" })).toBeEnabled();
    await page.screenshot({ path: "../../docs/screenshots/jira-connection.png", fullPage: true });
  });

  test("a sign-in that Atlassian refused says so and offers to sign in again", async ({ page }) => {
    await page.goto("/dev/jira?state=needs");
    await expect(page.locator("p[role=alert]")).toContainText("no longer accepts the saved sign-in");
    await expect(page.getByText("Sign in again needed")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in to Jira again" })).toBeEnabled();
  });

  test("not connected, not set up and a non-admin", async ({ page }) => {
    await page.goto("/dev/jira?state=none");
    await expect(page.getByText("Not connected yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect Jira" })).toBeEnabled();
    await page.goto("/dev/jira?state=none&configured=0");
    await expect(page.locator("p[role=alert]")).toContainText("not set up for this deployment");
    await expect(page.getByRole("button", { name: "Connect Jira" })).toBeDisabled();
    await page.goto("/dev/jira?role=viewer");
    await expect(page.getByText("An admin can connect Jira.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Disconnect|Connect/ })).toHaveCount(0);
  });

  test("returning from Atlassian shows the result, and the page has no accessibility violations", async ({ page }) => {
    await page.goto("/dev/jira?status=bad-link");
    await expect(page.getByRole("status")).toContainText("no longer valid");
    for (const url of ["/dev/jira", "/dev/jira?state=needs", "/dev/jira?state=none&configured=0"]) {
      await page.goto(url);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations, url).toEqual([]);
    }
  });
});
