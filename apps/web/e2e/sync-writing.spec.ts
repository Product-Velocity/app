import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page, scenario: string) => {
  await page.goto(`/dev/sync?scenario=${scenario}`);
  await page.getByRole("button", { name: "Open sync" }).click();
  await expect(page.getByRole("button", { name: "Apply and send" })).toBeEnabled();
};
const dialog = (page: Page) => page.getByRole("dialog", { name: /Sync with GitHub|Synced with GitHub/ });

test.describe("Sync with GitHub: writing progress", () => {
  test("shows Writing x/y and each result as it is written, then Close", async ({ page }) => {
    await open(page, "ok");
    // the counter changes faster than a test can poll, so every text it shows is recorded
    await page.evaluate(() => {
      const seen = new Set<string>();
      (window as unknown as { __seen: Set<string> }).__seen = seen;
      new MutationObserver(() => { for (const el of document.querySelectorAll('[role="status"]')) { const m = /Writing \d\/\d/.exec(el.textContent ?? ""); if (m) seen.add(m[0]); } }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    await page.getByRole("button", { name: "Apply and send" }).click();
    await expect(dialog(page).getByRole("heading", { name: "Synced with GitHub" })).toBeVisible();
    expect(await page.evaluate(() => [...(window as unknown as { __seen: Set<string> }).__seen])).toEqual(["Writing 0/3", "Writing 1/3", "Writing 2/3"]); // after the last one the list of results takes over
    await expect(dialog(page).getByRole("listitem")).toHaveCount(3);
    await expect(dialog(page).getByText("Updated")).toHaveCount(3);
    await page.screenshot({ path: "test-results/sync-writing-done.png" });
  });

  test("a failed initiative is reported on its own and sent again with Try again; the others are untouched", async ({ page }) => {
    await open(page, "fail");
    await page.getByRole("button", { name: "Apply and send" }).click();
    await expect(dialog(page).getByRole("heading", { name: "Synced with GitHub" })).toBeVisible();
    await expect(dialog(page).getByText("Updated")).toHaveCount(2);
    await expect(dialog(page).getByText("GitHub refused the update")).toBeVisible();
    await dialog(page).getByRole("button", { name: "Try again" }).click();
    await expect(dialog(page).getByText("Updated")).toHaveCount(3);
    await expect(dialog(page).getByRole("button", { name: "Try again" })).toHaveCount(0);
  });

  test("when GitHub changed for one, the writing stops there and the rest wait in the preview", async ({ page }) => {
    await open(page, "stale");
    await page.getByRole("button", { name: "Apply and send" }).click();
    await expect(dialog(page).getByText("GitHub changed after you looked")).toBeVisible();
    await expect(dialog(page).getByText(/Already written: R-1/)).toBeVisible();
    await expect(dialog(page).getByRole("listitem")).toHaveCount(2); // R-2 and R-3 are still open; R-1 is written
    await expect(page.getByTestId("calls")).toHaveText(/^R-1,R-2$/);
    await page.getByRole("button", { name: "Apply and send" }).click();
    await expect(dialog(page).getByRole("heading", { name: "Synced with GitHub" })).toBeVisible();
    await expect(dialog(page).getByText("Updated")).toHaveCount(3);
  });

  test("when the connection is lost the rest are reported as not sent", async ({ page }) => {
    await open(page, "lost");
    await page.getByRole("button", { name: "Apply and send" }).click();
    await expect(dialog(page).getByRole("heading", { name: "Synced with GitHub" })).toBeVisible();
    await expect(dialog(page).getByText("Not sent: the connection was lost")).toBeVisible();
    await expect(dialog(page).getByText("Updated")).toHaveCount(1);
  });
});
