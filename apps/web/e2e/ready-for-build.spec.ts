import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Ready for build at Gate B (issue #358, decision 2026-11-06-ready-at-gate-b): the Sync preview says what happens to the tracker status, nothing is written
// before the button, and the result says what was written. Same flow and wording for GitHub and Jira (tracker parity).
test.describe("Sync: Ready for build", () => {
  test("GitHub: the preview says Set Status to Ready, a board without Ready says add it, and the result lists the Status write", async ({ page }) => {
    await page.goto("/dev/sync?scenario=githubready");
    await page.getByRole("button", { name: "Open sync" }).click();
    const dialog = page.getByRole("dialog", { name: /Sync(ed)? with GitHub/ });
    const list = dialog.getByRole("list", { name: "Updates going out" });
    const r1 = list.getByRole("listitem").filter({ hasText: "R-1" });
    await expect(r1.getByText("Ready for build:")).toBeVisible();
    await expect(r1.getByText(/Set Status to Ready/)).toBeVisible();
    await expect(list.getByRole("listitem").filter({ hasText: "R-2" }).getByText(/add Ready in GitHub/)).toBeVisible();
    await expect(list.getByRole("listitem").filter({ hasText: "R-3" }).getByText("Ready for build:")).toHaveCount(0);
    await expect(page.getByTestId("calls")).toHaveText(""); // nothing is written before the person presses the button
    const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(axe.violations).toEqual([]);
    await page.screenshot({ path: "test-results/ready-github-preview.png" });
    await dialog.getByRole("button", { name: "Apply and send" }).click();
    await expect(dialog.getByText(/Title, Board Status: Ready/)).toBeVisible();
    await expect(dialog.getByText("Status set to Ready on the board.")).toBeVisible();
  });

  test("Jira: the preview says Move to To do, and the result lists the Status write", async ({ page }) => {
    await page.goto("/dev/sync?scenario=jiraready&new=jira0");
    await page.getByRole("button", { name: "Open sync" }).click();
    const dialog = page.getByRole("dialog", { name: /Sync(ed)? with Jira/ });
    await dialog.getByRole("radio", { name: "Keep Product Velocity" }).check(); // the description conflict of the shared Jira scenario
    await dialog.getByRole("button", { name: /^Next: what goes to Jira/ }).click();
    const r2 = dialog.getByRole("list", { name: "Updates going out" }).getByRole("listitem").filter({ hasText: "R-2" });
    await expect(r2.getByText("Ready for build:")).toBeVisible();
    await expect(r2.getByText(/Move to To do/)).toBeVisible();
    await expect(r2.getByText(/GitHub/)).toHaveCount(0);
    await expect(page.getByTestId("calls")).toHaveText("");
    const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(axe.violations).toEqual([]);
    await page.screenshot({ path: "test-results/ready-jira-preview.png" });
    await dialog.getByRole("button", { name: "Apply and send" }).dispatchEvent("click"); // the test page reloads itself when the writing ends
    await expect(dialog.getByText(/Name, Status: To do/)).toBeVisible();
    await expect(dialog.getByText("Moved to To do.")).toBeVisible();
  });
});
