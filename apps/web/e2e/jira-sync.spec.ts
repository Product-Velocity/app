import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Sync with Jira (issue #67, #71): Received lines, then what would be sent and the conflicts, then "Writing x/y" after the confirmation.
test.describe("Sync with Jira: received, to send, conflicts, writing", () => {
  test("shows Received, To send and a conflict; nothing is written until the person chooses and confirms", async ({ page }) => {
    await page.goto("/dev/sync?scenario=jira&new=jira0");
    await page.getByRole("button", { name: "Open sync" }).click();
    const dialog = page.getByRole("dialog", { name: /Sync(ed)? with Jira/ });
    // step 1: what came in from Jira, and the conflicts to settle; nothing is written here
    await expect(dialog.getByRole("heading", { name: "Updates from Jira to Product Velocity" })).toBeVisible();
    await expect(dialog.getByRole("listitem").filter({ hasText: /^1\. Incoming from Jira/ })).toHaveAttribute("aria-current", "step");
    await expect(dialog.getByText(/Received from Jira/)).toBeVisible();
    await expect(dialog.getByText("Build Status: Not started → In progress")).toBeVisible();
    await expect(dialog.getByText("Jira status: To Do → In Review")).toBeVisible();
    await expect(dialog.getByRole("link", { name: "issue PLAT-12" })).toHaveAttribute("href", "https://acme.example/browse/PLAT-12");
    await expect(dialog.getByText("Initiative Status is never set from Jira")).toBeVisible();
    await expect(dialog.getByText("Issue not found")).toBeVisible(); // the issue Jira did not return is reported, nothing changed
    await expect(dialog.getByText(/Text you or engineers write in the issue/)).toHaveCount(0); // GitHub-only wording is not shown for Jira
    await expect(page.getByTestId("calls")).toHaveText("");
    // a conflict has no default when both sides changed: the next step waits for the choice
    await expect(dialog.getByText("Conflict · Description")).toBeVisible();
    await expect(dialog.getByRole("radio", { name: "Keep Jira" })).not.toBeChecked();
    const next = dialog.getByRole("button", { name: /^Next: what goes to Jira/ });
    await expect(next).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
    await page.screenshot({ path: "test-results/jira-sync-incoming.png" });
    const axe1 = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(axe1.violations).toEqual([]);
    await dialog.getByRole("radio", { name: "Keep Product Velocity" }).check();
    await expect(next).toBeEnabled();
    await next.click();
    // step 2: what goes to Jira, one initiative at a time, with the filters
    await expect(dialog.getByRole("heading", { name: "Updates from Product Velocity to Jira" })).toBeVisible();
    await expect(dialog.getByText("Will update issue PLAT-13 in Jira")).toBeVisible();
    await expect(dialog.getByRole("button", { name: /^To send \(\d+\)$/ })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Back" })).toBeVisible();
    const send = dialog.getByRole("button", { name: "Apply and send" });
    await expect(send).toBeEnabled();
    await page.screenshot({ path: "test-results/jira-sync-outgoing.png" });
    const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(axe.violations).toEqual([]);
    await dialog.getByRole("button", { name: "Back" }).click(); // the choice is kept when going back
    await expect(dialog.getByRole("radio", { name: "Keep Product Velocity" })).toBeChecked();
    await dialog.getByRole("button", { name: /^Next: what goes to Jira/ }).click();
    await send.dispatchEvent("click"); // the test page reloads itself when the writing ends, which makes a real click wait for ever
    // step 3: confirmed, with both directions per initiative
    await expect(dialog.getByRole("listitem").filter({ hasText: /^3\. Confirmed/ })).toHaveAttribute("aria-current", "step");
    await expect(dialog.getByText("R-2 · Updated")).toBeVisible();
    await expect(dialog.getByRole("link", { name: "issue PLAT-13" })).toBeVisible();
    await expect(dialog.getByText("From Jira to Product Velocity:").first()).toBeVisible();
    await expect(dialog.getByText(/conflicts settled: Description \(kept Product Velocity\)/)).toBeVisible();
    await expect(dialog.getByText("From Product Velocity to Jira:").first()).toBeVisible();
    await expect(dialog.getByText("Name, Description, Labels (3)")).toBeVisible(); // what was written, in words
    await page.screenshot({ path: "test-results/jira-sync-confirmed.png" });
    await expect(page.getByTestId("calls")).toHaveText("R-2"); // only the initiative with something to send was written
  });

  test("Removed in Product Velocity: nothing is written before the button; one Done status is the default, several must be chosen, a refusal is shown with Try again", async ({ page }) => {
    await page.goto("/dev/sync?scenario=jira&new=jira0");
    await page.getByRole("button", { name: "Open sync" }).click();
    const dialog = page.getByRole("dialog", { name: /Sync(ed)? with Jira/ });
    await dialog.getByRole("radio", { name: "Keep Product Velocity" }).check(); // settle the conflict of step 1
    await dialog.getByRole("button", { name: /^Next: what goes to Jira/ }).click();
    const removed = dialog.getByRole("region", { name: "Removed in Product Velocity" });
    await expect(removed.getByText("Will add the label pv:removed and move the issue to “Done”.")).toHaveCount(2); // R-5 and the adopted R-9
    await expect(removed.getByText("Choose which Done status to move the issue to.")).toBeVisible();
    await expect(removed.getByText("will only add the label pv:removed. Close it in Jira.")).toBeVisible();
    await expect(removed.getByText("Jira could not be read just now.")).toBeVisible(); // R-8: nothing to confirm for it
    await expect(removed.getByRole("checkbox", { name: /R-8/ })).toBeDisabled();
    await expect(removed.getByRole("link", { name: "issue PLAT-20" })).toHaveAttribute("href", "https://acme.example/browse/PLAT-20");
    // an issue that was in Jira before Product Velocity took it over: red warning, never ticked for you
    await expect(removed.getByText("Warning: this issue was in Jira before Product Velocity took it over. Closing it ends real work there.")).toHaveCount(2); // R-9 and R-10
    await expect(removed.getByRole("checkbox", { name: /R-9/ })).not.toBeChecked();
    await expect(removed.getByRole("checkbox", { name: /R-5/ })).toBeChecked();
    // an issue Jira does not return can still be ticked, to mark it handled; the warning does not overlap the row (it is a block of its own)
    await expect(removed.getByRole("checkbox", { name: /R-10/ })).toBeEnabled();
    const row = await removed.getByRole("checkbox", { name: /R-9/ }).boundingBox();
    const warn = await removed.getByText("Warning: this issue was in Jira").first().boundingBox();
    expect(warn!.y).toBeGreaterThanOrEqual(row!.y + row!.height - 1);
    // the Deletions filter shows only this section
    await expect(dialog.getByRole("button", { name: /^Deletions \(\d+\)$/ })).toBeVisible();
    await dialog.getByRole("button", { name: /^Deletions/ }).click();
    await expect(dialog.getByText("R-1", { exact: false }).first()).toBeHidden();
    await expect(removed).toBeVisible();
    await dialog.getByRole("button", { name: /^All \(/ }).click();
    // several Done statuses and no choice yet: the button waits, and nothing was written
    const press = removed.getByRole("button", { name: "Label and close 3 in Jira" });
    await expect(press).toBeDisabled();
    await expect(page.getByTestId("closed")).toHaveText("");
    const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(axe.violations).toEqual([]);
    await page.screenshot({ path: "test-results/jira-removed-preview.png" });
    await removed.getByLabel("Done status for R-6").selectOption("41");
    await expect(press).toBeEnabled();
    await press.click();
    await expect(removed.getByText("Moved to Done and labelled pv:removed.")).toBeVisible();
    await expect(removed.getByText("Labelled only")).toBeVisible();
    await expect(removed.getByText(/Jira refused it: resolution: Resolution is required/)).toBeVisible();
    await expect(page.getByTestId("closed")).toHaveText("R-5:31,R-6:41,R-7:-");
    // the refusal is not retried by itself; Try again sends that one initiative alone
    await removed.getByRole("button", { name: "Try again" }).click();
    await expect(removed.getByText("Moved to Won't do and labelled pv:removed.")).toBeVisible();
    await expect(page.getByTestId("closed")).toHaveText("R-5:31,R-6:41,R-7:-,R-6:41");
    const after = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(after.violations).toEqual([]);
  });
});
