import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Velocity report (issue #545): the test page /dev/reports?demo=velocity has 150 fictional initiatives (14 Apr 2027 is today) with journeys through the gates and phases.
const open = async (page: Page, query = "") => {
  await page.goto(`/dev/reports?report=velocity&demo=velocity${query}`);
  await page.waitForSelector("[data-chart=velocity-bell]");
};
const kpi = (page: Page, id: string) => page.locator(`[data-kpi="${id}"]`);
const setting = (page: Page, group: string, name: string) => page.getByRole("group", { name: group, exact: true }).getByRole("button", { name, exact: true });
const num = async (page: Page, id: string) => Number((await kpi(page, id).innerText()).replace(/[^\d.]/g, ""));

test.describe("Velocity report", () => {
  test("is the fifth report, with the numbers of the finished initiatives and the ones still on the way counted apart", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("button", { name: "Velocity" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { name: "How long it takes: Total" })).toBeVisible();
    const counted = await num(page, "n-counted"), notYet = await num(page, "n-notyet");
    expect(counted).toBeGreaterThan(50);
    expect(counted + notYet).toBe(150);
    await expect(kpi(page, "median")).toContainText("wk");
    expect(await num(page, "p10")).toBeLessThan(await num(page, "median"));
    expect(await num(page, "median")).toBeLessThan(await num(page, "p90"));
  });

  test("the time measured changes the numbers; counted from the previous gate is only for Gate B and Gate C and is kept in the address", async ({ page }) => {
    await open(page);
    const total = await num(page, "median");
    await expect(setting(page, "Counted from", "Previous gate")).toBeDisabled();
    await setting(page, "Time measured", "To Gate A").click();
    await expect(page.getByRole("heading", { name: "How long it takes: To Gate A" })).toBeVisible();
    expect(await num(page, "median")).toBeLessThan(total);
    await setting(page, "Time measured", "To Gate B").click();
    await setting(page, "Counted from", "Previous gate").click();
    await expect(page.getByRole("heading", { name: "How long it takes: To Gate B (previous gate to this gate)" })).toBeVisible();
    expect(page.url()).toContain("m=gate_b");
    expect(page.url()).toContain("s=1");
    await page.reload();
    await page.waitForSelector("[data-chart=velocity-bell]");
    await expect(setting(page, "Time measured", "To Gate B")).toHaveAttribute("aria-pressed", "true");
    await expect(setting(page, "Counted from", "Previous gate")).toHaveAttribute("aria-pressed", "true");
    await setting(page, "Time measured", "Total").click();
    await expect(setting(page, "Counted from", "Start of Discovery")).toHaveAttribute("aria-pressed", "true"); // the stretch only applies to Gate B and C
    expect(page.url()).not.toContain("s=1");
  });

  test("the unit switches between weeks and days, and the break-down changes the group chart and the stages", async ({ page }) => {
    await open(page);
    await setting(page, "Unit", "Days").click();
    await expect(kpi(page, "median")).toContainText("d");
    await expect(kpi(page, "median")).not.toContainText("wk");
    await setting(page, "Unit", "Weeks").click();
    await setting(page, "Break down by", "Key Result").click();
    await expect(page.getByRole("heading", { name: "By Key Result", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Where the time goes, by Key Result" })).toBeVisible();
    expect(page.url()).toContain("by=key_result");
    await setting(page, "Break down by", "Focus Area").click();
    await expect(page.getByRole("heading", { name: "By Focus Area", exact: true })).toBeVisible();
  });

  test("the filter bar has Objective, Key Result, Business Line and Initiative Status, and Completed alone counts only completed initiatives", async ({ page }) => {
    await open(page);
    const bar = page.getByRole("region", { name: "Report filters" });
    for (const name of ["Objective", "Key Result", "Business Line", "Initiative Status", "Planned Quarter"]) await expect(bar.getByRole("button", { name })).toBeVisible();
    const before = await num(page, "n-counted");
    await bar.getByRole("button", { name: "Initiative Status" }).click();
    await page.getByRole("checkbox", { name: "Completed" }).check();
    await expect(page.getByText(/^\d+ of 150 initiatives$/)).not.toHaveText("150 of 150 initiatives");
    expect(await num(page, "n-counted")).toBeLessThanOrEqual(before);
    expect(page.url()).toContain("f.initiative_status=Completed");
  });

  test("clicking a size in the chart filters like the other charts, and the pill takes it off again", async ({ page }) => {
    await open(page);
    const before = await num(page, "n-counted");
    const chart = page.locator("[data-chart=velocity-size]");
    await chart.scrollIntoViewIfNeeded();
    const box = (await chart.boundingBox())!;
    // the five rows share the height of the plot (8px above, 30px below); the numbers on the right belong to the row, so a click there picks it
    const plot = box.height - 38, band = plot / 5;
    await page.mouse.click(box.x + box.width - 90, box.y + 8 + band * 4.5); // XL
    await expect(page.getByRole("button", { name: "Remove filter Effort: XL" })).toBeVisible();
    expect(await num(page, "n-counted")).toBeLessThan(before);
    await page.getByRole("button", { name: "Remove filter Effort: XL" }).click();
    await expect.poll(() => num(page, "n-counted")).toBe(before);
  });

  test("the sizes step up from XS to XL, and every chart has its numbers as a table", async ({ page }) => {
    await open(page);
    await page.locator("[aria-label=\"By T-shirt size\"] summary").click();
    const rows = await page.getByRole("table", { name: "Time by T-shirt size" }).locator("tbody tr").allInnerTexts();
    expect(rows.map((r) => r.split("\t")[0])).toEqual(["XS", "S", "M", "L", "XL"]);
    const medians = rows.map((r) => Number(r.split("\t")[2]));
    expect([...medians].sort((a, b) => a - b)).toEqual(medians);
    for (const name of ["Summary", "Median per quarter", "Share of elapsed time", "Average per stage", "Days to decide", "Time in each sub-phase"]) {
      await page.locator(`details:has(table[aria-label="${name}"]) summary`).first().scrollIntoViewIfNeeded();
      await expect(page.locator(`table[aria-label="${name}"]`).first()).toBeAttached();
    }
  });

  test("the list of all initiatives searches, filters and sorts", async ({ page }) => {
    await open(page);
    const list = page.getByRole("region", { name: "All initiatives", exact: true });
    await list.scrollIntoViewIfNeeded();
    const rows = list.locator("tbody tr");
    const all = await rows.count();
    await expect(list.getByRole("status")).toHaveText(`Showing ${all} of ${all}`);
    const slowest = Number(await rows.first().locator("td").nth(7).innerText());
    await list.getByRole("button", { name: "Fastest first" }).click();
    expect(Number(await rows.first().locator("td").nth(7).innerText())).toBeLessThan(slowest);
    await list.getByRole("searchbox", { name: "Search" }).fill("number 34 ");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("R-34");
    await list.getByRole("button", { name: "Clear" }).click();
    await expect(rows).toHaveCount(all);
    await list.getByLabel("Size").selectOption("XL");
    expect(await rows.count()).toBeLessThan(all);
    for (const t of await rows.locator("td:nth-child(4)").allInnerTexts()) expect(t).toBe("XL");
    await list.getByRole("searchbox", { name: "Search" }).fill("zzz");
    await expect(list.getByText("No initiatives match this search")).toBeVisible();
  });

  test("lists the initiatives in flight that are already slower than usual, and the requests waiting longest", async ({ page }) => {
    await open(page);
    const inflight = page.getByRole("region", { name: "In flight and already slower than usual" });
    await expect(inflight.locator("tbody tr").first()).toBeVisible();
    await expect(inflight.locator("tbody tr").first()).toContainText("over");
    await expect(page.getByRole("heading", { name: /Waiting now for a decision \(\d+\)/ })).toBeVisible();
  });

  test("a workspace with only Start Building dates: Total already counts the build time, and the phase chart shows what has dates", async ({ page }) => {
    await page.goto("/dev/reports?report=velocity&demo=velocity-build");
    await page.getByRole("button", { name: "Velocity" }).waitFor();
    // Total adds up the phases that have dates: here only Build has, so every finished build counts
    expect(await num(page, "n-counted")).toBeGreaterThan(10);
    await expect(page.locator(".vel-why")).toHaveCount(0);
    const phases = page.getByRole("region", { name: "Time in each phase", exact: true });
    await phases.scrollIntoViewIfNeeded();
    await phases.locator("summary").click();
    // only the phases that have dates are listed: Build (and the wait before it, from the Gate B decisions), nothing else
    const names = await phases.getByRole("table", { name: "Time in each phase" }).locator("tbody tr td:first-child").allInnerTexts();
    expect(names).toContain("Build");
    expect(names.every((n) => ["Build", "Waiting to start build"].includes(n))).toBe(true);
    // Build works from Start Building alone
    await setting(page, "Time measured", "Build").click();
    await expect(page.getByRole("heading", { name: "How long it takes: Build" })).toBeVisible();
    expect(await num(page, "n-counted")).toBeGreaterThan(10);
    expect(await num(page, "median")).toBeGreaterThan(0);
    // the stages are not empty: the Build stage holds the build time, so the stage averages add up to the average build
    await page.locator("details:has(table[aria-label=\"Average per stage\"]) summary").first().click();
    const head = await page.locator("table[aria-label=\"Average per stage\"] thead th").allInnerTexts();
    const first = await page.locator("table[aria-label=\"Average per stage\"] tbody tr").first().locator("td").allInnerTexts();
    const build = Number(first[head.indexOf("Build")]);
    expect(build).toBeGreaterThan(0);
    expect(build).toBeCloseTo(await num(page, "average"), 0);
    // every initiative of the list shows where its time went, and the longest stage is Build
    const list = page.getByRole("region", { name: "All initiatives", exact: true });
    await list.scrollIntoViewIfNeeded();
    const rows = list.locator("tbody tr");
    expect(await rows.count()).toBeGreaterThan(10);
    await expect(rows.first().locator(".vel-mini")).toBeVisible();
    await expect(rows.first().locator("td").last()).toContainText("Build");
    await expect(list.locator(".vel-mini")).toHaveCount(await rows.count());
  });

  test("the (i) on a range chart explains how to read it, for the mouse and the keyboard", async ({ page }) => {
    await open(page);
    const info = page.locator("[aria-label=\"By T-shirt size\"] .vel-info");
    await info.focus();
    await expect(info.locator(".vel-info-pop")).toBeVisible();
    await expect(info.locator(".vel-info-pop")).toContainText("middle half");
    await expect(info.locator(".vel-info-pop")).toContainText("average");
  });

  test("works at phone width without sideways scrolling and has no accessibility violations", async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    await open(page);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    const r = await new AxeBuilder({ page }).include(".reports").analyze();
    expect(r.violations.map((v) => v.id + ": " + v.nodes.map((n) => n.target).join(" | "))).toEqual([]);
  });
});
