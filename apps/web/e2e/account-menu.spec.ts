import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Issue #286: the avatar menu separates what is for every member, for workspace admins and for the platform owner.
const open = async (page: Page, who: string) => {
  await page.goto(`/dev/menu?who=${who}`);
  await page.locator("details.account summary").click();
};
const group = (page: Page, name: string) => page.getByRole("group", { name, exact: true });
const headings = (page: Page) => page.locator(".account-menu .menu-heading").allTextContents();

test.describe("account menu sections", () => {
  test("a viewer sees This workspace and You only, with no Trash and no admin or platform link", async ({ page }) => {
    await open(page, "viewer");
    expect(await headings(page)).toEqual(["This workspace", "You"]);
    await expect(group(page, "This workspace")).toContainText("Incoming issues");
    await expect(group(page, "This workspace")).toContainText("Members");
    await expect(group(page, "This workspace")).not.toContainText("Trash");
    await expect(group(page, "You")).toContainText("Connect an AI assistant");
    await expect(page.getByRole("link", { name: /GitHub|Jira|Audit log|Workspace settings|All accounts/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("a creator also gets the Trash, still nothing for admins", async ({ page }) => {
    await open(page, "creator");
    expect(await headings(page)).toEqual(["This workspace", "You"]);
    await expect(group(page, "This workspace")).toContainText("Trash");
  });

  test("an admin also gets Workspace admin: settings, audit log, GitHub and Jira, and no platform link", async ({ page }) => {
    await open(page, "admin");
    expect(await headings(page)).toEqual(["This workspace", "You", "Workspace admin"]);
    for (const name of ["Workspace settings", "Audit log", "GitHub", "Jira"]) await expect(group(page, "Workspace admin").getByRole("link", { name })).toBeVisible();
    await expect(page.getByRole("link", { name: /All accounts console|Platform audit log|Access settings/ })).toHaveCount(0);
    await expect(group(page, "This workspace")).not.toContainText("Workspace settings");
  });

  test("the platform owner gets the console, the platform audit log and access settings", async ({ page }) => {
    await open(page, "platform");
    expect(await headings(page)).toEqual(["This workspace", "You", "Workspace admin", "Platform owner"]);
    const platform = group(page, "Platform owner");
    await expect(platform.getByRole("link", { name: "All accounts console" })).toHaveAttribute("href", "/platform");
    await expect(platform.getByRole("link", { name: "Platform audit log" })).toHaveAttribute("href", "/platform/audit");
    await expect(platform.getByRole("link", { name: "Access settings" })).toHaveAttribute("href", "/platform/settings");
    await page.screenshot({ path: "../../docs/screenshots/account-menu.png", clip: { x: 1100, y: 0, width: 500, height: 900 } });
  });

  test("a platform admin inside a customer account gets no admin section, only that account's audit log under Platform owner", async ({ page }) => {
    await open(page, "inside");
    expect(await headings(page)).toEqual(["This workspace", "You", "Platform owner"]);
    await expect(group(page, "Platform owner").getByRole("link", { name: "This account’s audit log" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^GitHub$|^Jira$|Workspace settings/ })).toHaveCount(0);
  });

  test("every section is a labelled group, Escape closes the menu, and there are no accessibility violations", async ({ page }) => {
    await open(page, "platform");
    for (const n of ["This workspace", "You", "Workspace admin", "Platform owner"]) await expect(group(page, n)).toBeVisible();
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.locator(".account-menu")).toBeHidden();
  });
});
