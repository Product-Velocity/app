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
    expect((await popup).url()).toBe("https://github.com/Acme/App/issues/34");
    await expect(page.getByTestId("item-panel")).toHaveCount(0);
    // clicking the code itself still opens the panel
    await cell.click({ position: { x: 8, y: 8 } });
    await expect(page.getByTestId("item-panel")).toBeVisible();
    await expect(page.getByTestId("item-panel").locator("a.issue-link")).toHaveAttribute("href", "https://github.com/Acme/App/issues/34");
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

  test("the Description is in the Delivery view, after Initiative Status", async ({ page }) => {
    await open(page, "n=12&role=admin&view=Delivery");
    const ids = await page.evaluate(() => [...document.querySelectorAll(".ag-header-cell[col-id]")].map((h) => h.getAttribute("col-id")));
    expect(ids.indexOf("description")).toBe(ids.indexOf("initiative_status") + 1);
  });
});
