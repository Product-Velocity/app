import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// R-111 (issue #219): account switcher, platform banner, audit log table, All accounts console, linked emails. Fictional data (/dev/accounts).
const A = "0b6f2a1c-3d4e-4f50-8a9b-1c2d3e4f5a6b", B = "f1e2d3c4-b5a6-4978-8a69-5b4c3d2e1f00";

test.describe("account switcher (FR-1)", () => {
  test("a person with three accounts sees all three, searches, and switching keeps the tab", async ({ page }) => {
    await page.route("**/w/**", (route) => route.fulfill({ contentType: "text/html", body: "<h1>switched</h1>" }));
    await page.goto("/dev/accounts?accounts=3");
    await page.getByTestId("account-chip").click();
    const menu = page.getByRole("menu", { name: "Accounts" });
    await expect(menu.getByRole("menuitemradio")).toHaveCount(4); // 1 recent + 3 accounts (the active one is listed once more under Recent only when it is not active)
    await expect(menu.getByText("Recent")).toBeVisible();
    await expect(menu.getByRole("menuitemradio", { name: /Harbor Logistics/ })).toBeVisible();
    await expect(page.getByTestId("all-accounts-link")).toHaveCount(0); // platform admins only
    await expect(page.getByTestId("new-account-link")).toHaveAttribute("href", "/onboarding?new=1");
    // the search box stays inside the menu (it used to overflow)
    const menuBox = await page.getByTestId("account-menu").boundingBox();
    const searchBox = await page.getByLabel("Search accounts").boundingBox();
    expect(menuBox!.width).toBeGreaterThanOrEqual(320);
    expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(menuBox!.x + menuBox!.width + 0.5);
    await page.screenshot({ path: "../../docs/screenshots/account-switcher.png" });
    await page.getByRole("searchbox", { name: "Search accounts" }).or(page.getByRole("combobox", { name: "Search accounts" })).fill("north");
    await expect(menu.getByRole("menuitemradio")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/w/${B}/`));
  });

  test("keyboard: Escape closes, arrows move, one account shows no dropdown", async ({ page }) => {
    await page.goto("/dev/accounts?accounts=3");
    await page.getByTestId("account-chip").click();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitemradio").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("account-menu")).toHaveCount(0);
    await page.goto("/dev/accounts?accounts=1");
    await expect(page.getByTestId("account-chip")).toHaveCount(0);
    await expect(page.getByTestId("account-name")).toHaveText("Meridian Media");
  });

  test("platform admins also get the All accounts console link", async ({ page }) => {
    await page.goto("/dev/accounts?accounts=1&platform=1");
    await page.getByTestId("account-chip").click();
    await expect(page.getByTestId("all-accounts-link")).toHaveAttribute("href", "/platform");
    // one link per row: nothing else in the row is a link
    await expect(page.getByTestId("all-accounts-link").getByRole("link")).toHaveCount(0);
    await page.screenshot({ path: "../../docs/screenshots/account-switcher-platform.png" });
  });
});

test.describe("platform banner (FR-2.3)", () => {
  test("names the admin, the account and the access level", async ({ page }) => {
    await page.goto("/dev/accounts?platform=1");
    const banner = page.getByTestId("platform-banner");
    await expect(banner).toContainText("Viewing as platform admin");
    await expect(banner).toContainText("Pat Owner (pat@productvelocity.test)");
    await expect(banner).toContainText("Meridian Media");
    await expect(page.getByTestId("platform-level")).toHaveText("Read & write access");
    await page.screenshot({ path: "../../docs/screenshots/platform-banner.png" });
    await page.goto("/dev/accounts?platform=ro");
    await expect(page.getByTestId("platform-level")).toHaveText("Read-only access");
  });
  test("no banner for an ordinary member", async ({ page }) => {
    await page.goto("/dev/accounts");
    await expect(page.getByTestId("platform-banner")).toHaveCount(0);
  });
});

test.describe("audit log (FR-6)", () => {
  test("every entry shows name and email, role, when, where, what, old and new, and platform admin entries carry the badge", async ({ page }) => {
    await page.goto("/dev/accounts?view=audit&platform=1");
    const rows = page.getByTestId("audit-row");
    await expect(rows).toHaveCount(5);
    const platform = rows.nth(0);
    await expect(platform).toContainText("Pat Owner (pat@productvelocity.test)");
    await expect(platform).toContainText("Platform admin");
    await expect(platform.getByTestId("platform-badge")).toBeVisible();
    await expect(platform).toContainText("Platform"); // project
    await expect(platform).toContainText("Checkout redesign");
    await expect(platform).toContainText("Checkout redesign v2");
    const admin = rows.nth(1);
    await expect(admin).toContainText("Lena Admin (lena@meridian.test)");
    await expect(admin).toContainText("Account Admin");
    await expect(admin.getByTestId("platform-badge")).toHaveCount(0);
    await expect(rows.nth(2)).toContainText("Entered the account");
    await expect(rows.nth(3)).toContainText("batch b3c0ffee");
    await expect(rows.nth(3)).toContainText("batch b3c0ffee");
    expect(await rows.nth(3).innerText()).toEqual(expect.stringContaining("requested"));
    await page.screenshot({ path: "../../docs/screenshots/audit-log.png", fullPage: true });
  });
  test("filters and export are offered", async ({ page }) => {
    await page.goto("/dev/accounts?view=audit");
    const bar = page.getByRole("form", { name: "Filter the audit log" });
    for (const l of ["Person or email", "Action", "Project", "From", "To"]) await expect(bar.getByLabel(l)).toBeVisible();
    await expect(page.getByRole("link", { name: "Export CSV" })).toHaveAttribute("href", /\/dev\/accounts\/export/);
  });
  test("has no accessibility violations", async ({ page }) => {
    await page.goto("/dev/accounts?view=audit&platform=1");
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });
});

test.describe("All accounts console (FR-2.2, v2)", () => {
  test("is an AG Grid with usage, people, AI agents, integrations, search, view chips and a members drawer", async ({ page }) => {
    await page.goto("/dev/accounts?view=console&platform=1");
    const grid = page.getByTestId("accounts-grid");
    await expect(grid.getByText("Meridian Media").first()).toBeVisible();
    await expect(page.getByTestId("accounts-summary")).toContainText("3 accounts · 18 members · 214 line items · 1 with AI agents connected · 1 paused");
    await expect(grid).toContainText("187"); // line items
    await expect(grid).toContainText("Claude Desktop ×3");
    await expect(grid).toContainText("meridian.test ↗");
    await expect(grid).toContainText("Paused");
    await expect(grid).toContainText("Reconnect needed");
    await expect(grid).toContainText("Read-only");
    // the same action bar as the Roadmap: Filter, Columns, Group by, Search
    const bar = page.getByRole("region", { name: "Accounts tools" });
    await bar.getByRole("button", { name: /^Filter/ }).click();
    await page.getByRole("button", { name: "Paused", exact: true }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("accounts-summary")).toContainText("1 account ·");
    await expect(grid.getByText("Meridian Media")).toHaveCount(0);
    await page.getByRole("button", { name: "Remove filter Paused" }).click();
    await expect(page.getByTestId("accounts-summary")).toContainText("3 accounts ·");
    await bar.getByRole("button", { name: /^Group by/ }).click();
    await page.getByRole("group", { name: "Group by options" }).getByRole("button", { name: "Status" }).click();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(grid.getByRole("button", { name: "Collapse group Paused" })).toBeVisible();
    await bar.getByRole("button", { name: /^Columns/ }).click();
    await expect(page.getByRole("group", { name: "Choose columns" })).toBeVisible();
    await page.keyboard.press("Escape");
    await bar.getByRole("searchbox", { name: "Search accounts" }).fill("harbor");
    await expect(page.getByTestId("accounts-summary")).toContainText("1 account ·");
    await bar.getByRole("searchbox", { name: "Search accounts" }).fill("");
    // the drawer: details, actions, people with their moves, delete asks for the name
    await page.getByRole("button", { name: "Manage Meridian Media" }).click();
    const drawer = page.getByTestId("account-drawer");
    await expect(drawer).toContainText("Claude Desktop");
    await expect(drawer).toContainText("412 calls");
    await expect(drawer.getByTestId("account-people").getByRole("row")).toHaveCount(5);
    await expect(drawer.getByRole("button", { name: "Pause lena@meridian.test" })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Approve new@meridian.test" })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Resend email" })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Pause access" })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Send invitation email" })).toBeDisabled(); // needs an address first
    await drawer.getByLabel("Email").fill("someone@meridian.test");
    await expect(drawer.getByRole("button", { name: "Send invitation email" })).toBeEnabled();
    await page.screenshot({ path: "../../docs/screenshots/platform-console-drawer.png" });
    const del = drawer.locator("details.delete-account");
    await del.locator("summary").click();
    await expect(del).toContainText("Deletes Meridian Media with its 12 members, 4 projects and 187 line items");
    await expect(del.getByLabel("Type Meridian Media to confirm deleting it")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await page.screenshot({ path: "../../docs/screenshots/platform-console.png" });
  });
  test("a paused account offers Resume, not Pause", async ({ page }) => {
    await page.goto("/dev/accounts?view=console&platform=1");
    await page.getByRole("button", { name: "Manage Northwind Agency" }).click();
    const drawer = page.getByTestId("account-drawer");
    await expect(drawer).toContainText("Members cannot open this account");
    await expect(drawer.getByRole("button", { name: "Resume access" })).toBeVisible();
  });
  test("has no accessibility violations", async ({ page }) => {
    await page.goto("/dev/accounts?view=console&platform=1");
    await expect(page.getByTestId("accounts-grid").getByText("Meridian Media").first()).toBeVisible();
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });
});

test.describe("linked emails (FR-4)", () => {
  test("shows sign-in, verified and pending addresses and where notifications go", async ({ page }) => {
    await page.goto("/dev/accounts?view=emails");
    const list = page.getByTestId("linked-emails");
    await expect(list.locator("li")).toHaveCount(3);
    await expect(list.locator("li").nth(0)).toContainText("Sign-in address");
    await expect(list.locator("li").nth(1)).toContainText("Notifications go here");
    await expect(list.locator("li").nth(2)).toContainText("Not verified yet");
    await expect(page.getByLabel("6-digit code")).toBeVisible(); // a pending address offers the code form
    await expect(page.getByRole("button", { name: "Send code" })).toBeVisible();
    await page.screenshot({ path: "../../docs/screenshots/linked-emails.png" });
  });
});

void A;
