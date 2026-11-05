import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// The file routes need a signed-in Supabase session, so these tests stand in for them with an in-page fake server
// and check what the person sees. The server rules are covered by unit and database tests.
type F = { id: string; name: string; mime: string; size: number; shareUrl: string | null };

async function fakeFiles(page: Page, start: F[] = []) {
  const files = [...start];
  await page.route("**/api/files**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const m = url.pathname.match(/^\/api\/files\/([^/]+)(\/share)?$/);
    if (!m && req.method() === "GET") return json({ files });
    if (!m && req.method() === "POST") {
      const body = req.postDataBuffer()?.toString("latin1") ?? "";
      if (body.includes('filename="bad.svg"')) return json({ error: "Only PNG, JPEG, GIF, WebP and PDF files can be attached." }, 422);
      files.push({ id: `f${files.length + 1}`, name: "mockup.png", mime: "image/png", size: 2048, shareUrl: `http://localhost/f/${"T".repeat(43)}/mockup.png` });
      return json({ file: files.at(-1) }, 201);
    }
    const f = files.find((x) => x.id === m![1]);
    if (!f) return json({ error: "File not found." }, 404);
    if (!m![2] && req.method() === "PATCH") { f.name = (JSON.parse(req.postData() ?? "{}") as { name: string }).name; return json({ name: f.name }); }
    if (m![2]) {
      const on = (JSON.parse(req.postData() ?? "{}") as { on: boolean }).on;
      f.shareUrl = on ? `http://localhost/f/${"T".repeat(43)}/${f.name}` : null;
      return json({ shareUrl: f.shareUrl });
    }
    files.splice(files.indexOf(f), 1);
    return json({ ok: true });
  });
}
const openPanel = async (page: Page, role = "admin") => {
  await page.goto(`/dev/grid?n=12&role=${role}`);
  await page.waitForSelector(".ag-row");
  await page.locator('.ag-row[row-id="item-3"] [col-id="item_code"]').click({ position: { x: 8, y: 8 } });
  await expect(page.getByTestId("item-panel")).toBeVisible();
  await page.getByTestId("item-panel").getByRole("tab", { name: "Spec" }).click();
  return page.getByTestId("item-panel").locator(".files");
};

test.describe("Files on an initiative", () => {
  test("attach (shared by default), rename, do not share, share again, copy link in the menu, remove", async ({ page }) => {
    await fakeFiles(page);
    const field = await openPanel(page);
    await expect(field.getByText("No files yet.")).toBeVisible();
    await field.locator('input[type="file"]').setInputFiles({ name: "mockup.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]) });
    const row = field.locator('[data-file="mockup.png"]');
    await expect(row.getByRole("link", { name: "mockup.png" })).toHaveAttribute("target", "_blank");
    await expect(row.getByRole("button", { name: /Shared with GitHub/ })).toHaveAttribute("aria-pressed", "true");
    await row.getByRole("button", { name: "Actions for mockup.png" }).click();
    await expect(row.getByRole("menuitem", { name: "Copy link" })).toBeVisible();
    await page.screenshot({ path: "../../docs/screenshots/files-share-link.png" });
    const r = await new AxeBuilder({ page }).include(".files").withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((x) => x.id)).toEqual([]);
    await page.keyboard.press("Escape"); // closes the menu, not the panel
    await expect(page.getByTestId("item-panel")).toBeVisible();
    // rename
    await row.getByRole("button", { name: "Actions for mockup.png" }).click();
    await row.getByRole("menuitem", { name: "Rename" }).click();
    await row.getByLabel("Name of mockup.png").fill("Checkout mockup.png");
    await row.getByLabel("Name of mockup.png").press("Enter");
    const renamed = field.locator('[data-file="Checkout mockup.png"]');
    await expect(renamed.getByRole("link", { name: "Checkout mockup.png" })).toBeVisible();
    // do not share, then share again
    await renamed.getByRole("button", { name: /Shared with GitHub/ }).click();
    await expect(renamed.getByRole("button", { name: /Only in Product Velocity/ })).toHaveAttribute("aria-pressed", "false");
    await renamed.getByRole("button", { name: "Actions for Checkout mockup.png" }).click();
    await expect(renamed.getByRole("menuitem", { name: "Copy link" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await renamed.getByRole("button", { name: /Only in Product Velocity/ }).click();
    await expect(renamed.getByRole("button", { name: /Shared with GitHub/ })).toBeVisible();
    // remove (asks first)
    page.once("dialog", (d) => void d.accept());
    await renamed.getByRole("button", { name: "Actions for Checkout mockup.png" }).click();
    await renamed.getByRole("menuitem", { name: "Remove" }).click();
    await expect(field.getByText("No files yet.")).toBeVisible();
  });

  test("a refused file explains why", async ({ page }) => {
    await fakeFiles(page);
    const field = await openPanel(page);
    await field.locator('input[type="file"]').setInputFiles({ name: "bad.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
    await expect(page.getByTestId("item-panel").getByRole("alert")).toHaveText("Only PNG, JPEG, GIF, WebP and PDF files can be attached.");
  });

  test("a viewer sees the files but cannot attach, share, rename or remove", async ({ page }) => {
    await fakeFiles(page, [{ id: "f1", name: "spec.pdf", mime: "application/pdf", size: 5000, shareUrl: null }]);
    const field = await openPanel(page, "viewer");
    await expect(field.getByRole("link", { name: "spec.pdf" })).toBeVisible();
    await expect(field.getByText("Only in Product Velocity")).toBeVisible(); // shown as text, not a switch
    await expect(field.getByRole("button", { name: /Only in Product Velocity/ })).toHaveCount(0);
    await expect(field.locator('input[type="file"]')).toHaveCount(0);
    await field.getByRole("button", { name: "Actions for spec.pdf" }).click();
    await expect(field.getByRole("menuitem")).toHaveText(["Open", "Download"]);
    await expect(page.getByRole("button", { name: "Add ▾" })).toHaveCount(0);
  });

  test("the toolbar has one Add menu; the filter and search sit on one line", async ({ page }) => {
    await fakeFiles(page);
    await openPanel(page);
    const panel = page.getByTestId("item-panel");
    await panel.getByRole("button", { name: "Add ▾" }).click();
    await expect(panel.getByRole("menuitem")).toHaveText(["Write a document", "Upload files", "Add a link"]);
    await page.keyboard.press("Escape");
    const ax = await new AxeBuilder({ page }).include(".docs").withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(ax.violations.map((x) => x.id)).toEqual([]);
    await page.screenshot({ path: "../../docs/screenshots/spec-tab.png" });
    const boxes = await Promise.all([panel.getByLabel("Search the documents, files and links of this initiative"), panel.getByRole("button", { name: "Documents", exact: true }), panel.getByRole("button", { name: "Add ▾" })].map((l) => l.boundingBox()));
    const mid = boxes.map((b) => b!.y + b!.height / 2);
    expect(Math.max(...mid) - Math.min(...mid)).toBeLessThan(2); // the same line
    expect(new Set(boxes.map((b) => Math.round(b!.height))).size).toBe(1); // the same height
  });
});
