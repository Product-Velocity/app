import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page, query = "n=30&view=All columns&cols=all") => {
  await page.goto(`/dev/grid?${query}`);
  await page.waitForSelector(".ag-row");
  await page.waitForFunction(() => (window as unknown as { __pv?: unknown }).__pv !== undefined);
};
const cell = (page: Page, id: string, col: string) => page.locator(`.ag-row[row-id="${id}"] [col-id="${col}"]`);
const picker = (page: Page) => page.getByRole("combobox", { name: /Choose an option/ });
const settle = (page: Page) => page.waitForFunction(() => (window as unknown as { __pv: { controller: { status: { pending: number } } } }).__pv.controller.status.pending === 0);
const themeOf = (page: Page, id: string) => page.evaluate((i) => (window as unknown as { __pv: { controller: { row: (id: string) => { theme?: string } } } }).__pv.controller.row(i).theme ?? null, id);
const startPicker = async (page: Page, id: string) => {
  await cell(page, id, "theme").click();
  await page.keyboard.press("Enter");
  await expect(picker(page)).toBeFocused();
};

test.describe("Initiative Group in the grid (open list)", () => {
  test("the picker offers the workspace's groups, A to Z, and Enter picks one", async ({ page }) => {
    await open(page);
    await startPicker(page, "item-1");
    await expect(page.getByRole("option")).toHaveText(["No group", "Onboarding", "Platform health", "Retention"]);
    await page.keyboard.type("plat");
    await page.keyboard.press("Enter");
    await settle(page);
    await expect(cell(page, "item-1", "theme")).toHaveText("Platform health");
  });

  test("typing a new group offers to create it, and it is saved and offered next time", async ({ page }) => {
    await open(page);
    await startPicker(page, "item-2");
    await page.keyboard.type("Billing");
    await expect(page.getByRole("option", { name: "Create “Billing”" })).toBeVisible();
    await page.keyboard.press("Enter");
    await settle(page);
    await expect(cell(page, "item-2", "theme")).toHaveText("Billing");
    expect(await themeOf(page, "item-2")).toBe("Billing");
    await startPicker(page, "item-3");
    await expect(page.getByRole("option", { name: "Billing" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("a look-alike is pointed out; typing the same group in another case reuses the existing one", async ({ page }) => {
    await open(page);
    await startPicker(page, "item-4");
    await page.keyboard.type("On-boarding");
    await expect(page.getByRole("status").filter({ hasText: "Looks like “Onboarding”" })).toBeVisible();
    await page.keyboard.press("Escape");
    await startPicker(page, "item-4");
    await page.keyboard.type("retention");
    await page.keyboard.press("Enter");
    await settle(page);
    await expect(cell(page, "item-4", "theme")).toHaveText("Retention");
    // typing the exact text into an editor on the keyboard path (no picker) still keeps the spelling
    const r = await page.evaluate(() => { const c = (window as unknown as { __pv: { controller: { edit: (id: string, f: string, v: string) => unknown; row: (id: string) => { theme: string } } } }).__pv.controller; c.edit("item-5", "theme", "ONBOARDING"); return c.row("item-5").theme; });
    expect(r).toBe("Onboarding");
  });

  test("one undo puts the old group back", async ({ page }) => {
    await open(page);
    await startPicker(page, "item-6");
    await page.keyboard.type("Billing");
    await page.keyboard.press("Enter");
    await settle(page);
    await page.getByRole("button", { name: /^Undo/ }).click();
    await settle(page);
    await expect(cell(page, "item-6", "theme")).toHaveText("");
  });
});

test.describe("quick-add +group", () => {
  test("+onb uses Onboarding, +billing creates a new group and says so", async ({ page }) => {
    await open(page, "n=10");
    const input = page.getByLabel("Add an initiative");
    await input.fill("Fix invites #platform +onb");
    await expect(page.locator(".token-chip", { hasText: "Initiative Group: Onboarding" })).toBeVisible();
    await expect(page.locator(".token-chip", { hasText: "(new group)" })).toHaveCount(0);
    await input.fill("Invoices #platform +billing");
    await expect(page.locator(".token-chip", { hasText: "Initiative Group: billing (new group)" })).toBeVisible();
    await input.fill("Welcome mail #platform +onbording");
    await expect(page.locator(".quick-add-similar", { hasText: "looks like the existing group “Onboarding”" })).toBeVisible();
    await input.fill("Invoices #platform +billing");
    await input.press("Enter");
    await settle(page);
    const last = await page.evaluate(() => { const c = (window as unknown as { __pv: { controller: { rows: { initiative_name: string; theme?: string }[]; groupNames: () => string[] } } }).__pv.controller; return { row: c.rows.find((r) => r.initiative_name === "Invoices")?.theme, groups: c.groupNames() }; });
    expect(last.row).toBe("billing");
    expect(last.groups).toContain("billing");
  });
});

test.describe("Initiative Groups tidy-up", () => {
  const admin = async (page: Page, role = "admin") => { await page.goto(`/dev/groups?role=${role}`); await page.getByRole("table").waitFor(); };
  const row = (page: Page, name: string) => page.getByRole("row", { name: new RegExp(`^${name}`) });

  test("lists groups with counts and points out look-alikes", async ({ page }) => {
    await admin(page);
    await expect(row(page, "Onboarding ")).toContainText("4");
    await expect(page.locator(".quick-add-similar")).toContainText("“On-boarding” and “Onboarding”");
  });

  test("rename, merge with undo, retire unused", async ({ page }) => {
    await admin(page);
    await page.getByRole("button", { name: "Rename Retention" }).click();
    await page.getByLabel("New name").fill("Customer retention");
    await page.getByRole("button", { name: "Rename", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Renamed “Retention” to “Customer retention”. 3 initiatives updated");
    await expect(row(page, "Customer retention")).toContainText("3");
    // merge the look-alike into Onboarding, then undo
    await page.getByRole("button", { name: "Merge On-boarding into another group" }).click();
    await page.getByLabel("Move its initiatives to").selectOption({ label: "Onboarding" });
    await page.getByRole("button", { name: "Merge groups" }).click();
    await expect(page.getByRole("status")).toContainText("Merged “On-boarding” into “Onboarding”: 2 initiatives moved");
    await expect(row(page, "Onboarding ")).toContainText("6");
    await expect(page.getByRole("row", { name: /^On-boarding/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("status")).toContainText("Merge undone");
    await expect(row(page, "On-boarding")).toContainText("2");
    await expect(row(page, "Onboarding ")).toContainText("4");
    // only an unused group can be retired
    await expect(page.getByRole("button", { name: "Retire Onboarding" })).toBeDisabled();
    await page.getByRole("button", { name: "Retire Unused idea" }).click();
    await page.getByRole("button", { name: "Retire group" }).click();
    await expect(page.getByRole("row", { name: /^Unused idea/ })).toHaveCount(0);
  });

  test("a duplicate name is explained; Escape closes the dialog", async ({ page }) => {
    await admin(page);
    await page.getByRole("button", { name: "Rename Retention" }).click();
    await page.getByLabel("New name").fill("onboarding");
    await page.getByRole("button", { name: "Rename", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText("There is already a group with that name.");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("non-admins see the list but no actions; the screen passes the accessibility check", async ({ page }) => {
    await admin(page, "creator");
    await expect(page.getByRole("button", { name: /^Rename/ })).toHaveCount(0);
    await expect(row(page, "Retention")).toBeVisible();
    await admin(page);
    await page.getByRole("button", { name: "Rename Retention" }).click();
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });
});
