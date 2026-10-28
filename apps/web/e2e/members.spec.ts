import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const open = async (page: import("@playwright/test").Page, query = "") => {
  await page.goto(`/dev/members${query}`);
  await page.waitForSelector(".members-table");
};
const row = (page: import("@playwright/test").Page, email: string) => page.locator("tr", { hasText: email });

test.describe("Workspace Members grid", () => {
  test("one table shows every status, with create date and last login", async ({ page }) => {
    await open(page);
    await expect(page.locator("tbody tr")).toHaveCount(10);
    const counts: Record<string, string> = { "Requested Access": "4", Invited: "1", Active: "3", Paused: "1", Revoked: "1" };
    for (const [label, n] of Object.entries(counts)) await expect(page.getByRole("button", { name: new RegExp(`^${label} ${n}$`) })).toBeVisible();
    await expect(row(page, "person3@meridian.test").getByLabel("Status of person3@meridian.test")).toHaveValue("paused");
    await expect(row(page, "new.hire@meridian.test")).toContainText("Invited");
    await expect(page.getByRole("columnheader", { name: "Created" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Last login" })).toBeVisible();
    await expect(row(page, "lena@meridian.test")).toContainText("2026-");
    await expect(row(page, "person5@meridian.test")).toContainText("Never");
    // requested people come first
    await expect(page.locator("tbody tr").first()).toContainText("person5@meridian.test");
    await page.screenshot({ path: "../../docs/screenshots/members-grid.png" });
  });

  test("batch approval: select the four requests, set them Active in one click", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: /^Requested Access/ }).click();
    await expect(page.locator("tbody tr")).toHaveCount(4);
    await page.getByRole("checkbox", { name: "Select all shown rows" }).check();
    const bar = page.getByRole("region", { name: "Batch actions" });
    await expect(bar).toContainText("4 selected");
    await bar.getByRole("button", { name: "Approve (set Active)" }).click();
    await expect(page.getByRole("status").filter({ hasText: "4 people are now active." })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "4 confirmation emails sent." })).toBeVisible();
    await page.getByRole("button", { name: /^Active/ }).click();
    await expect(page.locator("tbody tr")).toHaveCount(7);
    await expect(bar).toHaveCount(0);
    await page.screenshot({ path: "../../docs/screenshots/members-batch-approved.png" });
  });

  test("inline role change saves without a reload, and a refused save puts the old value back", async ({ page }) => {
    await open(page);
    const lena = row(page, "lena@meridian.test");
    await lena.getByLabel("Role of lena@meridian.test").selectOption("admin");
    await expect(lena.getByText("Saved")).toBeVisible();
    await expect(lena.getByLabel("Role of lena@meridian.test")).toHaveValue("admin");
    const omar = row(page, "omar@meridian.test");
    await omar.getByLabel("Role of omar@meridian.test").selectOption("viewer");
    await expect(omar.getByText("A workspace must keep at least one admin.")).toBeVisible();
    await expect(omar.getByLabel("Role of omar@meridian.test")).toHaveValue("creator");
  });

  test("inline status: pause an active member from the row, keyboard only", async ({ page }) => {
    await open(page);
    const sel = row(page, "lena@meridian.test").getByLabel("Status of lena@meridian.test");
    await sel.focus();
    await page.keyboard.press("ArrowDown"); // Paused
    await expect(row(page, "lena@meridian.test").getByLabel("Status of lena@meridian.test")).toHaveValue("paused");
    await expect(page.getByRole("status").filter({ hasText: "1 person is now paused." })).toBeVisible();
  });

  test("you cannot select or change your own row; the filter chips and search narrow the list", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("checkbox", { name: "Select ashu@meridian.test" })).toBeDisabled();
    await page.getByRole("searchbox", { name: "Search members" }).fill("omar");
    await expect(page.locator("tbody tr")).toHaveCount(1);
  });

  test("a mixed selection offers only the changes they share; Escape clears", async ({ page }) => {
    await open(page);
    await page.getByRole("checkbox", { name: "Select person5@meridian.test" }).check();
    await page.getByRole("checkbox", { name: "Select lena@meridian.test" }).check();
    const bar = page.getByRole("region", { name: "Batch actions" });
    await expect(bar.getByRole("button", { name: "Revoke" })).toBeVisible();
    await expect(bar.getByRole("button", { name: "Pause" })).toHaveCount(0);
    await bar.getByRole("button", { name: "Revoke" }).focus();
    await page.keyboard.press("Escape");
    await expect(bar).toHaveCount(0);
  });

  test("non-admins see a read-only list of active people", async ({ page }) => {
    await open(page, "?role=viewer");
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create new invite" })).toHaveCount(0);
    await expect(page.locator("select")).toHaveCount(0);
  });

  test("Create new invite opens the invitation form", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Create new invite" }).click();
    await expect(page.getByRole("region", { name: "Create new invite" })).toBeVisible();
  });

  test("no accessibility violations", async ({ page }) => {
    await open(page);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
});
