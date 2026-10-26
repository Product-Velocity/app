import { test } from "@playwright/test";
test("debug pin", async ({ page }) => {
  await page.goto("/dev/grid?n=30&role=admin&view=Prioritisation&cols=all");
  await page.waitForSelector(".ag-row");
  await page.getByRole("button", { name: /columns shown$/ }).click();
  const panel = page.getByRole("group", { name: "Choose columns" });
  const names = await panel.getByRole("list", { name: "Selected columns in order" }).getByRole("listitem").locator(".name").allInnerTexts();
  console.log("ORDER", names.slice(0, 6).join(" | "));
  await panel.getByRole("button", { name: `Pin ${names[3]}` }).click();
  await panel.getByRole("button", { name: /^Apply columns/ }).click();
  await page.waitForTimeout(500);
  console.log("PINNED HEADERS", await page.locator(".ag-pinned-left-header").innerText());
  console.log("URLS", page.url());
});
