import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page, query = "n=12&role=admin&gh=1") => {
  await page.goto(`/dev/grid?${query}`);
  await page.waitForSelector(".ag-row");
  await page.waitForFunction(() => (window as unknown as { __pv?: unknown }).__pv !== undefined);
};
const row = (page: Page, id: string) => page.locator(`.ag-row[row-id="${id}"]`);
const settle = (page: Page) => page.waitForFunction(() => (window as unknown as { __pv: { controller: { status: { pending: number } } } }).__pv.controller.status.pending === 0);

test.describe("the tracker issue next to the Initiative ID", () => {
  test("a linked item shows #34 next to R-01 as a link that opens the ticket in a new tab", async ({ page, context }) => {
    await context.route("https://github.com/**", (r) => r.fulfill({ body: "ticket", contentType: "text/html" }));
    await open(page);
    const cell = row(page, "item-1").locator('[col-id="item_code"]');
    await expect(cell).toContainText("R-01");
    const link = cell.getByRole("link", { name: "Open issue #34 in a new tab" });
    await expect(link).toHaveText("#34");
    await expect(link).toHaveAttribute("href", "https://github.com/Acme/App/issues/34");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    // an item without a ticket shows only its code
    await expect(row(page, "item-2").locator('[col-id="item_code"] a')).toHaveCount(0);
    // clicking the link opens GitHub in a new tab and leaves the grid and the panel alone
    const popup = context.waitForEvent("page");
    await link.click();
    const opened = await popup;
    await opened.waitForLoadState(); // the address is known once the page has loaded, not when the tab appears
    expect(opened.url()).toBe("https://github.com/Acme/App/issues/34");
    await expect(page.getByTestId("item-panel")).toHaveCount(0);
    // clicking the code itself still opens the panel
    await cell.click({ position: { x: 8, y: 8 } });
    await expect(page.getByTestId("item-panel")).toBeVisible();
    await expect(page.getByTestId("item-panel").locator("a.issue-link")).toHaveAttribute("href", "https://github.com/Acme/App/issues/34");
  });

  test("a Jira-linked item shows its ticket key next to the code, and its panel says Jira, not GitHub", async ({ page }) => {
    await open(page, "n=12&role=admin&jira=1");
    const link = row(page, "item-1").locator('[col-id="item_code"]').getByRole("link", { name: "Open issue SCRUM-2 in a new tab" });
    await expect(link).toHaveText("SCRUM-2");
    await expect(link).toHaveAttribute("href", "https://acme.atlassian.net/browse/SCRUM-2");
    await expect(row(page, "item-3").locator('[col-id="item_code"] a')).toHaveCount(0);
    await row(page, "item-1").locator('[col-id="item_code"]').click({ position: { x: 8, y: 8 } });
    const panel = page.getByTestId("item-panel");
    await expect(panel.getByRole("button", { name: /^Sync with Jira/ })).toBeVisible();
    await expect(panel.getByText(/Jira: issue SCRUM-2 · status In Progress \(in progress\)/)).toBeVisible();
    await expect(panel.getByRole("tab", { name: "Jira" })).toBeVisible();
    await expect(panel.getByRole("tab", { name: "GitHub" })).toHaveCount(0);
    await panel.getByRole("tab", { name: "Jira" }).click();
    await expect(panel.getByText("Read only. This initiative follows the issue; nothing is sent to Jira.")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Take ownership" })).toBeVisible();
    await expect(panel.getByText(/Update GitHub/)).toHaveCount(0);
    await panel.getByRole("button", { name: "Take ownership" }).click();
    await expect(panel.getByText(/Product Velocity now owns this initiative. Nothing was written to Jira/)).toBeVisible();
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((x) => x.id)).toEqual([]);
  });

  test("the Jira tab lists the children of the linked issue, read only, with sub-tasks under their parent", async ({ page }) => {
    await open(page, "n=12&role=admin&jira=1");
    await row(page, "item-1").locator('[col-id="item_code"]').click({ position: { x: 8, y: 8 } });
    const panel = page.getByTestId("item-panel");
    await panel.getByRole("tab", { name: "Jira" }).click();
    const table = panel.getByRole("table", { name: "Issues under SCRUM-2" });
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader")).toHaveText(["Issue", "Title", "Type", "Status", "Assignee"]);
    const rows = table.locator("tbody tr");
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText("SCRUM-17");
    await expect(rows.nth(0)).toContainText("Feature");
    await expect(rows.nth(0)).toContainText("In Progress (in progress)");
    await expect(rows.nth(0)).toContainText("Dana Reyes");
    // sub-tasks are indented under their parent; an unassigned one says so; the key links to the Jira browse page
    await expect(rows.nth(1)).toContainText("↳ SCRUM-20");
    await expect(rows.nth(2)).toContainText("↳ SCRUM-21");
    await expect(rows.nth(2)).toContainText("Unassigned");
    await expect(rows.nth(1).getByRole("link", { name: "SCRUM-20" })).toHaveAttribute("href", "https://acme.atlassian.net/browse/SCRUM-20");
    await expect(rows.nth(3)).toContainText("Done (done)");
    // the roll-up counts the leaves, and says a done issue is not a done initiative
    await expect(panel.getByText(/2 of 3 issues done/)).toBeVisible();
    await expect(panel.getByText(/not that the initiative is complete/)).toBeVisible();
    // read only: nothing in the table can be edited, and the grid columns follow the roll-up
    await expect(table.getByRole("textbox")).toHaveCount(0);
    await expect(table.getByRole("button")).toHaveCount(0);
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((x) => x.id)).toEqual([]);
  });

  test("an initiative with no children read yet says where they come from", async ({ page }) => {
    await open(page, "n=12&role=admin&jira=1");
    await row(page, "item-2").locator('[col-id="item_code"]').click({ position: { x: 8, y: 8 } });
    const panel = page.getByTestId("item-panel");
    await panel.getByRole("tab", { name: "Jira" }).click();
    await expect(panel.getByText(/No child issues read yet/)).toBeVisible();
    await expect(panel.getByText(/of \d+ issues? done/)).toHaveCount(0);
  });

  test("without a connection nothing is shown, and the grid has no accessibility violations with the link", async ({ page }) => {
    await open(page, "n=12&role=admin");
    await expect(page.locator("a.issue-link")).toHaveCount(0);
    await open(page);
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((x) => x.id)).toEqual([]);
  });
});

test.describe("Description (Markdown)", () => {
  const field = (page: Page) => page.getByTestId("item-panel").locator('[data-field="description"]');
  const openPanel = async (page: Page, id = "item-3") => {
    await row(page, id).locator('[col-id="item_code"]').click({ position: { x: 8, y: 8 } });
    await expect(page.getByTestId("item-panel")).toBeVisible();
  };

  test("write Markdown, it autosaves with undo; Preview shows how it reads", async ({ page }) => {
    await open(page);
    await openPanel(page);
    const box = field(page).getByRole("textbox");
    await box.fill("## Goal\n\n- parse the file\n- map the columns\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    await box.blur();
    await settle(page);
    const stored = await page.evaluate(() => (window as unknown as { __pv: { source: { items: { id: string; description?: string }[] } } }).__pv.source.items.find((i) => i.id === "item-3")!.description);
    expect(stored).toContain("## Goal");
    await expect(page.locator(".pvbar")).toContainText("Description");
    await field(page).getByRole("button", { name: "Preview" }).click();
    const preview = field(page).getByTestId("markdown-preview");
    await expect(preview.getByRole("heading", { name: "Goal" })).toBeVisible();
    await expect(preview.getByRole("listitem")).toHaveCount(2);
    await expect(preview.getByRole("table")).toBeVisible();
    await field(page).getByRole("button", { name: "Write" }).click();
    await page.keyboard.press("Control+z");
    await settle(page);
    await expect(field(page).getByRole("textbox")).toHaveValue("");
  });

  test("raw HTML is shown as text, images are not loaded, links open in a new tab", async ({ page }) => {
    await open(page);
    await openPanel(page);
    const box = field(page).getByRole("textbox");
    await box.fill('<script>window.__pwned = 1</script>\n\n![tracker](https://evil.example/pixel.png)\n\n[spec](https://example.test/spec)');
    await box.blur();
    await field(page).getByRole("button", { name: "Preview" }).click();
    const preview = field(page).getByTestId("markdown-preview");
    await expect(preview).toContainText("<script>window.__pwned = 1</script>");
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    await expect(preview.locator("img")).toHaveCount(0);
    await expect(preview).toContainText("[image: tracker]");
    const a = preview.getByRole("link", { name: "spec" });
    await expect(a).toHaveAttribute("target", "_blank");
    await expect(a).toHaveAttribute("rel", /noopener/);
  });

  test("more than 20,000 characters is refused in words and nothing is saved", async ({ page }) => {
    await open(page);
    await openPanel(page);
    const box = field(page).getByRole("textbox");
    await box.fill("x".repeat(20001));
    await box.blur();
    await expect(field(page).getByRole("alert")).toContainText(/20000|20,000|too long/i);
    const stored = await page.evaluate(() => (window as unknown as { __pv: { source: { items: { id: string; description?: string }[] } } }).__pv.source.items.find((i) => i.id === "item-3")!.description);
    expect(stored ?? "").toBe("");
  });

  test("viewers see the Description but cannot change it", async ({ page }) => {
    await open(page, "n=12&role=viewer&gh=1");
    await openPanel(page);
    await expect(field(page).getByRole("textbox")).toBeDisabled();
  });

  test("the Description is in the Delivery view, after Planning Status", async ({ page }) => {
    await open(page, "n=12&role=admin&view=Delivery");
    const ids = await page.evaluate(() => [...document.querySelectorAll(".ag-header-cell[col-id]")].map((h) => h.getAttribute("col-id")));
    expect(ids.indexOf("planning_status")).toBeGreaterThan(-1);
    expect(ids.indexOf("description")).toBe(ids.indexOf("planning_status") + 1);
  });
});

test.describe("Last Synced and Synced With", () => {
  test("the Delivery view shows when and with what each initiative was last synced; others say Not synced", async ({ page }) => {
    await open(page, "n=12&role=admin&gh=1&view=Delivery");
    const synced = row(page, "item-1");
    await expect(synced.locator('[col-id="synced_with"]')).toContainText('GitHub · Acme/App · board "Product Velocity roadmap"');
    await expect(synced.locator('[col-id="last_synced"]')).not.toHaveText("");
    await expect(synced.locator('[col-id="last_synced"]')).not.toContainText("Not synced");
    // who owns it sits next to Synced With; Delivery Status is not in this view while it is switched off (decision 2026-10-28)
    await expect(synced.locator('[col-id="tracker_ownership"]')).toContainText("Product Velocity");
    await expect(row(page, "item-2").locator('[col-id="tracker_ownership"]')).toContainText("Not linked");
    await expect(row(page, "item-2").locator('[col-id="last_synced"]')).toContainText("Not synced");
    await expect(row(page, "item-2").locator('[col-id="synced_with"]')).toContainText("Not synced");
    await page.screenshot({ path: "../../docs/screenshots/last-synced-columns.png" });
  });
  test("the item panel says when it was last synced, and the two fields cannot be edited", async ({ page }) => {
    await open(page, "n=12&role=admin&gh=1");
    await row(page, "item-1").locator('[col-id="item_code"]').click({ position: { x: 8, y: 8 } });
    const panel = page.getByTestId("item-panel");
    await expect(panel.locator(".ip-gh")).toContainText("last synced");
    for (const key of ["last_synced", "synced_with"]) {
      await expect(panel.locator(`[data-field="${key}"]`).getByRole("textbox")).toHaveCount(0);
    }
  });
});
