import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Sync with Jira (issue #67, #71): Received lines, then what would be sent and the conflicts, then "Writing x/y" after the confirmation.
test.describe("Sync with Jira: received, to send, conflicts, writing", () => {
  test("shows Received, To send and a conflict; nothing is written until the person chooses and confirms", async ({ page }) => {
    await page.goto("/dev/sync?scenario=jira&new=jira0");
    await page.getByRole("button", { name: "Open sync" }).click();
    const dialog = page.getByRole("dialog", { name: /Sync(ed)? with Jira/ });
    await expect(dialog.getByText(/Received from Jira/)).toBeVisible();
    await expect(dialog.getByText("Build Status: Not started → In progress")).toBeVisible();
    await expect(dialog.getByText("Jira status: To Do → In Review")).toBeVisible();
    await expect(dialog.getByRole("link", { name: "issue PLAT-12" })).toHaveAttribute("href", "https://acme.example/browse/PLAT-12");
    await expect(dialog.getByText("Will update issue PLAT-13 in Jira")).toBeVisible();
    await expect(dialog.getByText("Initiative Status is never set from Jira")).toBeVisible();
    await expect(dialog.getByText("Issue not found")).toBeVisible(); // the issue Jira did not return is reported, nothing changed
    await expect(dialog.getByText(/Text you or engineers write in the issue/)).toHaveCount(0); // GitHub-only wording is not shown for Jira
    await expect(page.getByTestId("calls")).toHaveText("");
    // a conflict has no default when both sides changed: sending waits for the choice
    await expect(dialog.getByText("Conflict · Description")).toBeVisible();
    await expect(dialog.getByRole("radio", { name: "Keep Jira" })).not.toBeChecked();
    const send = dialog.getByRole("button", { name: "Apply and send" });
    await expect(send).toBeDisabled();
    await page.screenshot({ path: "test-results/jira-sync-preview.png" });
    const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(axe.violations).toEqual([]);
    await dialog.getByRole("radio", { name: "Keep Product Velocity" }).check();
    await expect(send).toBeEnabled();
    await send.dispatchEvent("click"); // the test page reloads itself when the writing ends, which makes a real click wait for ever
    await expect(dialog.getByText("R-2 · Updated")).toBeVisible();
    await expect(dialog.getByRole("link", { name: "issue PLAT-13" })).toBeVisible();
    await expect(page.getByTestId("calls")).toHaveText("R-2"); // only the initiative with something to send was written
  });
});
