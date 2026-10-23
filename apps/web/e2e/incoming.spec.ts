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
    await page.getByLabel("Issue type").selectOption("Bug");
    await expect(page.getByRole("row", { name: /Checkout fails/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Export the roadmap/ })).toHaveCount(0);
    await page.getByLabel("Issue type").selectOption("");
    await page.getByLabel("Repository").selectOption("Acme/Notes");
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
    await page.getByLabel("Project for the new initiatives").selectOption({ label: "Marketplace" });
    await page.getByRole("button", { name: /^Pull in 1/ }).click();
    const status = page.getByRole("status").filter({ hasText: "Pulled 1 issue into Marketplace" });
    await expect(status).toContainText("nothing was written to GitHub");
    await expect(tab(page, /Pulled in/)).toContainText("2");
    await page.getByRole("button", { name: "Undo pull in" }).click();
    await expect(tab(page, /Pulled in/)).toContainText("1");
    await expect(page.getByRole("row", { name: /Export the roadmap/ })).toBeVisible();
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
});
