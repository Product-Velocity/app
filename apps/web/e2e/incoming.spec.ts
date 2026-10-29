import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page, query = "") => {
  await page.goto(`/dev/incoming${query}`);
  await expect(page.getByRole("heading", { name: "Incoming" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Not pulled/ })).toBeVisible();
};
const tab = (page: Page, name: RegExp) => page.getByRole("tab", { name });
const pick = (page: Page, number: number) => page.getByRole("checkbox", { name: new RegExp(`Select #${number} `) }).check();

test.describe("Incoming list", () => {
  test("three states with counts; filters narrow the list", async ({ page }) => {
    await open(page);
    await expect(tab(page, /Not pulled/)).toContainText("8");
    await expect(tab(page, /Ignored/)).toContainText("1");
    await expect(tab(page, /Pulled in/)).toContainText("1");
    await page.getByLabel("Issue type", { exact: true }).selectOption("Bug");
    await expect(page.getByRole("row", { name: /Checkout fails/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Export the roadmap/ })).toHaveCount(0);
    await page.getByLabel("Issue type", { exact: true }).selectOption("");
    await page.getByLabel("Repository", { exact: true }).selectOption("Acme/Notes");
    await expect(page.getByRole("row", { name: /Old spike notes/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Checkout fails/ })).toHaveCount(0);
  });

  test("ignore with a reason, see it under Ignored, and undo the whole batch in one step", async ({ page }) => {
    await open(page);
    await pick(page, 101);
    await pick(page, 103);
    await page.getByLabel("Reason for ignoring (optional)").fill("not roadmap work");
    await page.getByRole("button", { name: /^Ignore 2/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "Ignored 2 issues" })).toBeVisible();
    await expect(tab(page, /Ignored/)).toContainText("3");
    await tab(page, /Ignored/).click();
    await expect(page.getByRole("row", { name: /Checkout fails/ })).toContainText("not roadmap work");
    await page.getByRole("button", { name: "Undo ignore" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Put 2 issues back" })).toBeVisible();
    await expect(tab(page, /Ignored/)).toContainText("1");
    await expect(tab(page, /Not pulled/)).toContainText("8");
  });

  test("bring an ignored issue back, then pull it in; nothing is written to GitHub and the undo removes the initiative", async ({ page }) => {
    await open(page);
    await tab(page, /Ignored/).click();
    await expect(page.getByRole("row", { name: /Customer asks about invoices/ })).toContainText("Rule: label support");
    await pick(page, 104);
    await page.getByRole("button", { name: "Bring back to Not pulled" }).click();
    await expect(tab(page, /Not pulled/)).toContainText("9");
    await tab(page, /Not pulled/).click();
    await pick(page, 102);
    await page.getByLabel("Pull in to project").selectOption({ label: "Marketplace" });
    await page.getByRole("button", { name: /^Pull in 1/ }).click();
    const status = page.getByRole("status").filter({ hasText: "Pulled 1 issue into Marketplace" });
    await expect(status).toContainText("nothing was written to GitHub");
    await expect(tab(page, /Pulled in/)).toContainText("2");
    await page.getByRole("button", { name: "Undo pull in" }).click();
    await expect(tab(page, /Pulled in/)).toContainText("1");
    await expect(page.getByRole("row", { name: /Export the roadmap/ })).toBeVisible();
  });

  test("Read only is the default; choosing Product Velocity owns it says so, and nothing is written to GitHub", async ({ page }) => {
    await open(page);
    await expect(page.getByLabel("Who owns the new initiatives")).toHaveValue("follow");
    await pick(page, 102);
    await page.getByLabel("Who owns the new initiatives").selectOption({ label: "Product Velocity owns it" });
    await page.getByRole("button", { name: /^Pull in 1/ }).click();
    const status = page.getByRole("status").filter({ hasText: "Pulled 1 issue" });
    await expect(status).toContainText("Product Velocity owns what they are");
    await expect(status).toContainText("until you sync and confirm");
    await expect(status).toContainText("nothing was written to GitHub");
    await expect(status).not.toContainText("read-only");
  });

  test("ignoring a parent offers to ignore its sub-issues, and a sub-issue names its parent", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("row", { name: /map columns/ })).toContainText("sub-issue of #106");
    await pick(page, 106);
    await page.getByRole("button", { name: /^Ignore 1/ }).click();
    const ask = page.getByRole("alertdialog", { name: "Ignore the sub-issues too?" });
    await expect(ask).toContainText("2 of the selected issues have parents");
    await ask.getByRole("button", { name: "Ignore them too" }).click();
    await expect(tab(page, /Ignored/)).toContainText("4");
  });

  test("rules: admins add and remove them, and say they only reach new arrivals; others cannot", async ({ page }) => {
    await open(page);
    await expect(page.getByText("Label is support → Ignore")).toBeVisible();
    await page.getByLabel("Rule kind").selectOption("type");
    await page.getByLabel("Rule value").fill("Bug");
    await page.getByRole("button", { name: "Add rule" }).click();
    await expect(page.getByText("Issue type is Bug → Ignore")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "never changes issues already here" })).toBeVisible();
    await expect(tab(page, /Not pulled/)).toContainText("8"); // the existing bug stays where it is
    await page.getByRole("button", { name: "Remove the rule Label is support" }).click();
    await expect(page.getByText("Label is support → Ignore")).toHaveCount(0);
    await open(page, "?role=viewer");
    await expect(page.getByRole("button", { name: "Add rule" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Pull in/ })).toHaveCount(0);
    await expect(page.getByText("Only admins change the rules.")).toBeVisible();
  });

  test("the filters sit next to each other in one row", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await open(page);
    const ys = await page.locator(".incoming-filters > *").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(ys.length).toBe(6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(6); // the same line, not stacked
  });

  test("the order is the issues, then what to do with them, then the rules; the dropdowns have names", async ({ page }) => {
    await open(page);
    const y = async (loc: ReturnType<Page["locator"]>) => (await loc.first().boundingBox())!.y;
    const list = await y(page.getByRole("region", { name: "Issues", exact: true }));
    const bring = await y(page.getByRole("heading", { name: "What to do with the selected issues" }));
    const rules = await y(page.getByRole("heading", { name: "Rules for future arrivals" }));
    expect(list).toBeLessThan(bring);
    expect(bring).toBeLessThan(rules);
    for (const name of ["Pull in to project", "Who owns the new initiatives", "Reason for ignoring (optional)"]) await expect(page.getByLabel(name)).toBeVisible();
    await expect(page.getByText("A rule applies only to issues that arrive from now on")).toBeVisible();
  });

  test("a long list scrolls inside its own box and the header stays in view", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 400 });
    await open(page);
    const box = page.getByRole("region", { name: "Issues", exact: true });
    const m = await box.evaluate((el) => ({ scrolls: el.scrollHeight > el.clientHeight, overflow: getComputedStyle(el).overflowY }));
    expect(m).toEqual({ scrolls: true, overflow: "auto" });
    const head = page.locator(".incoming-table thead th").nth(1);
    const fromTop = async () => (await head.boundingBox())!.y - (await box.boundingBox())!.y; // where the header sits inside the box
    const before = await fromTop();
    await box.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect(page.getByRole("row", { name: /Old spike notes/ })).toBeVisible(); // the last row has scrolled into view
    expect(Math.abs((await fromTop()) - before)).toBeLessThan(3); // and the header is still pinned at the top of the box
  });

  test("Select all shown, Invert selection and Clear", async ({ page }) => {
    await open(page);
    const count = page.locator(".incoming-pick");
    await expect(count).toContainText("0 of 8 issues selected");
    await pick(page, 101);
    await page.getByRole("button", { name: "Invert selection" }).click();
    await expect(count).toContainText("7 of 8 issues selected");
    await expect(page.getByRole("checkbox", { name: /Select #101 / })).not.toBeChecked();
    await page.getByRole("button", { name: "Select all shown" }).click();
    await expect(count).toContainText("8 of 8 issues selected");
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(count).toContainText("0 of 8 issues selected");
  });

  test("ignore everything of one type and keep it ignored for later arrivals; the rule is offered only for exactly one condition", async ({ page }) => {
    await open(page);
    await expect(page.getByText("Also ignore future issues like this")).toHaveCount(0); // no filter, nothing to save
    await page.getByLabel("Issue type", { exact: true }).selectOption("Feature");
    await expect(page.getByLabel(/Also ignore future issues like this \(issue type is Feature\)/)).toBeVisible();
    await page.getByRole("button", { name: "Select all shown" }).click();
    await page.getByLabel(/Also ignore future issues like this/).check();
    await page.getByRole("button", { name: /^Ignore 3/ }).click();
    await page.getByRole("button", { name: "Only the selected" }).click(); // #106 has sub-issues that are not selected: asked first
    const status = page.getByRole("status").filter({ hasText: "Ignored 3 issues" });
    await expect(status).toContainText("Saved for issues that arrive from now on: Issue type is Feature → Ignore");
    await expect(page.locator(".incoming-rules li", { hasText: "Issue type is Feature" })).toContainText("→ Ignore"); // now in the rules list
    // and with a second condition the rule is not offered, and the reason is given
    await page.getByLabel("Issue type", { exact: true }).selectOption("Task");
    await page.getByLabel("Label", { exact: true }).selectOption({ index: 1 });
    await expect(page.getByLabel(/Also ignore future issues like this/)).toHaveCount(0);
    await expect(page.getByText(/filter on exactly one of type, label or repository/)).toBeVisible();
  });
});
