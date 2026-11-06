import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Sync with GitHub, "Removed in Product Velocity" (decision 2026-11-03-github-close-removed; the twin of the Jira test in jira-sync.spec.ts).
test.describe("Sync with GitHub: Removed in Product Velocity", () => {
  test("nothing is written before the button; the words say close as not planned; an adopted issue warns in red and is not ticked; a refusal is shown with Try again", async ({ page }) => {
    await page.goto("/dev/sync?scenario=githubremoved");
    await page.getByRole("button", { name: "Open sync" }).click();
    const dialog = page.getByRole("dialog", { name: /Sync(ed)? with GitHub/ });
    const removed = dialog.getByRole("region", { name: "Removed in Product Velocity" });
    await expect(removed).toBeVisible();
    await expect(removed.getByText(/closes it as “not planned” in GitHub/)).toBeVisible();
    await expect(removed.getByText(/Jira/)).toHaveCount(0); // the same words, GitHub's name
    // what will happen, per initiative
    await expect(removed.getByText("Will add the label pv:removed and close the issue as “not planned”.")).toHaveCount(2); // R-5 and the adopted R-7
    await expect(removed.getByText("Already closed (closed as completed): will only add the label pv:removed.")).toBeVisible(); // R-6
    await expect(removed.getByRole("link", { name: "issue acme/app#201" })).toHaveAttribute("href", "https://github.com/acme/app/issues/201");
    await expect(removed.getByText("GitHub state: open")).toHaveCount(2);
    // no Done status to choose in GitHub
    await expect(removed.getByRole("combobox")).toHaveCount(0);
    // a repository the app may not write to: shown, nothing to confirm
    await expect(removed.getByText("acme/ro is marked read-only in Settings > GitHub: the app never writes to it.")).toBeVisible();
    await expect(removed.getByRole("checkbox", { name: /R-8/ })).toBeDisabled();
    // adopted from GitHub: red warning, never ticked for you; the warning does not overlap the row
    await expect(removed.getByText("Warning: this issue was in GitHub before Product Velocity took it over. Closing it ends real work there.")).toHaveCount(2); // R-7 and R-9
    await expect(removed.getByRole("checkbox", { name: /R-7/ })).not.toBeChecked();
    await expect(removed.getByRole("checkbox", { name: /R-5/ })).toBeChecked();
    await expect(removed.getByRole("checkbox", { name: /R-9/ })).toBeEnabled(); // an issue GitHub no longer has can be ticked, to mark it handled
    const row = await removed.getByRole("checkbox", { name: /R-7/ }).boundingBox();
    const warn = await removed.getByText("Warning: this issue was in GitHub").first().boundingBox();
    expect(warn!.y).toBeGreaterThanOrEqual(row!.y + row!.height - 1);
    // the Deletions filter shows only this section
    await dialog.getByRole("button", { name: /^Deletions/ }).click();
    await expect(removed).toBeVisible();
    await dialog.getByRole("button", { name: /^All \(/ }).click();
    // nothing was written before the person presses the button
    const press = removed.getByRole("button", { name: "Label and close 2 in GitHub" });
    await expect(press).toBeEnabled();
    await expect(page.getByTestId("closed")).toHaveText("");
    const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(axe.violations).toEqual([]);
    await page.screenshot({ path: "test-results/github-removed-preview.png" });
    // the person ticks the adopted one on purpose
    await removed.getByRole("checkbox", { name: /R-7/ }).check();
    await expect(removed.getByRole("button", { name: "Label and close 3 in GitHub" })).toBeEnabled();
    await removed.getByRole("button", { name: "Label and close 3 in GitHub" }).click();
    await expect(removed.getByText("Already done, labelled")).toBeVisible();
    await expect(removed.getByText(/GitHub is limiting requests right now/)).toBeVisible(); // R-7: the label was added, the close was not done
    await expect(removed.getByText("Closed as not planned and labelled pv:removed.")).toHaveCount(1); // R-5
    await expect(page.getByTestId("closed")).toHaveText("R-5:-,R-6:-,R-7:-"); // never a transition to choose
    // the refusal is not retried by itself; Try again sends that one initiative alone
    await removed.getByRole("button", { name: "Try again" }).click();
    await expect(removed.getByText("Closed as not planned and labelled pv:removed.")).toHaveCount(2);
    await expect(page.getByTestId("closed")).toHaveText("R-5:-,R-6:-,R-7:-,R-7:-");
    const after = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(after.violations).toEqual([]);
  });

  test("an initiative stopped at a gate is offered with the gate and closes the same way (issue #343)", async ({ page }) => {
    await page.goto("/dev/sync?scenario=githubstopped");
    await page.getByRole("button", { name: "Open sync" }).click();
    const dialog = page.getByRole("dialog", { name: /Sync(ed)? with GitHub/ });
    const removed = dialog.getByRole("region", { name: "Removed or stopped in Product Velocity" });
    await expect(removed).toBeVisible();
    await expect(removed.getByText("Stopped at gate B")).toBeVisible();
    await expect(removed.getByText(/A stopped initiative is one an approver stopped/)).toBeVisible();
    await expect(page.getByTestId("closed")).toHaveText("");
    await removed.getByRole("button", { name: "Label and close 2 in GitHub" }).click();
    await expect(removed.getByText("Closed as not planned and labelled pv:removed.")).toHaveCount(2);
    await expect(page.getByTestId("closed")).toHaveText("S-1:-,R-5:-");
    const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(axe.violations).toEqual([]);
  });

  test("the ordinary GitHub sync shows no Removed section when nothing was removed", async ({ page }) => {
    await page.goto("/dev/sync?scenario=ok");
    await page.getByRole("button", { name: "Open sync" }).click();
    await expect(page.getByRole("button", { name: "Apply and send" })).toBeEnabled();
    await expect(page.getByRole("region", { name: "Removed in Product Velocity" })).toHaveCount(0);
  });
});
