import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Sync with Jira, the read half (issue #67, #71): Received lines for linked initiatives, "To send" empty and honest about it.
test.describe("Sync with Jira: received, nothing to send", () => {
  test("shows what Jira changed as Received, says sending to Jira is not built yet, and writes nothing", async ({ page }) => {
    await page.goto("/dev/sync?scenario=jira&new=jira0");
    await page.getByRole("button", { name: "Open sync" }).click();
    const dialog = page.getByRole("dialog", { name: /Sync with Jira/ });
    await expect(dialog.getByText(/Received from Jira/)).toBeVisible();
    await expect(dialog.getByText("Build Status: Not started → In progress")).toBeVisible();
    await expect(dialog.getByText("Jira status: To Do → In Review")).toBeVisible();
    await expect(dialog.getByRole("link", { name: "issue PLAT-12" })).toHaveAttribute("href", "https://acme.example/browse/PLAT-12");
    await expect(dialog.getByText("Sending to Jira is not built yet").first()).toBeVisible();
    await expect(dialog.getByText("Initiative Status is never set from Jira")).toBeVisible();
    await expect(dialog.getByText("Issue not found")).toBeVisible(); // the issue Jira did not return is reported, nothing changed
    // nothing to confirm: the button only closes, and no write was made
    await expect(dialog.getByRole("button", { name: "Done" })).toBeEnabled();
    await expect(dialog.getByRole("button", { name: "Apply and send" })).toHaveCount(0);
    await expect(dialog.getByText(/Text you or engineers write in the issue/)).toHaveCount(0); // GitHub-only wording is not shown for Jira
    await page.screenshot({ path: "test-results/jira-sync-received.png" });
    const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(axe.violations).toEqual([]);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("calls")).toHaveText("");
  });
});
