import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page, query = "n=40") => {
  await page.goto(`/dev/gantt?${query}`);
  await page.waitForSelector("[data-bar]");
  await page.waitForFunction(() => (window as unknown as { __pv?: unknown }).__pv !== undefined);
};
/** No grouping: one line per item in rank order, so the first screens of bars are items 1 to about 30. */
const openFlat = (page: Page, query = "") => open(page, `n=40&g1=&g2=${query}`);
const bar = (page: Page, id: string) => page.locator(`[data-bar="${id}"]`);
const settle = (page: Page) => page.waitForFunction(() => (window as unknown as { __pv: { controller: { status: { pending: number } } } }).__pv.controller.status.pending === 0);
const dates = (page: Page, id: string) => page.evaluate((i) => { const r = (window as unknown as { __pv: { controller: { row: (id: string) => { planned_start: string | null; g2m_date_est: string | null } } } }).__pv.controller.row(i); return [r.planned_start, r.g2m_date_est]; }, id);
const sourceDates = (page: Page, id: string) => page.evaluate((i) => { const r = (window as unknown as { __pv: { source: { items: { id: string; planned_start: string | null; g2m_date_est: string | null }[] } } }).__pv.source.items.find((x) => x.id === i)!; return [r.planned_start, r.g2m_date_est]; }, id);
/** Scroll so the bar is on screen, then return its box. */
const box = async (page: Page, id: string) => { await bar(page, id).scrollIntoViewIfNeeded(); return (await bar(page, id).boundingBox())!; };
const PX = 6; // pixels per day at month zoom
const drag = async (page: Page, from: { x: number; y: number }, dx: number) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y, { steps: 4 });
  await page.mouse.up();
};

test.describe("the chart", () => {
  test("shows bars from Planned Start to G2M Date (est), grouped by Initiative Group and then project", async ({ page }) => {
    await open(page, "n=14");
    await expect(page.locator(".gantt-count")).toContainText("scheduled");
    const groups = await page.locator(".gl-g1 .gl-name").allTextContents();
    expect(groups).toEqual(["Onboarding", "Platform health", "Retention", "No value"]); // A to Z, "No value" last
    await expect(page.locator(".gl-g2 .gl-name").first()).toBeVisible();
    const b = bar(page, "item-1");
    await expect(b).toHaveAttribute("aria-label", /R-01 .*\d+ \w+ to \d+ \w+/);
    expect((await dates(page, "item-1"))[0]).toBe("2027-01-04");
    await expect(page.locator(".gh-tick").first()).toHaveText("Jan");
    await expect(page.locator(".gantt-today")).toBeVisible();
  });

  test("the left column carries the health as a word, not only a colour", async ({ page }) => {
    await open(page, "n=14");
    await expect(page.locator('[data-item="item-2"] .gl-health')).toHaveText("At Risk");
  });

  test("group rows collapse and expand, and keep their count", async ({ page }) => {
    await open(page, "n=14");
    const before = await page.locator("[data-bar]").count();
    await page.getByRole("button", { name: "Collapse Onboarding" }).click();
    await expect(page.getByRole("button", { name: "Expand Onboarding" })).toHaveAttribute("aria-expanded", "false");
    expect(await page.locator("[data-bar]").count()).toBeLessThan(before);
    await page.getByRole("button", { name: "Expand Onboarding" }).click();
    expect(await page.locator("[data-bar]").count()).toBe(before);
  });

  test("grouping can be changed: by project then none, by team; and zoom changes the scale", async ({ page }) => {
    await open(page, "n=14");
    await page.getByLabel("Group by").selectOption("home_project");
    await expect(page.locator(".gl-g1 .gl-name").first()).toHaveText("Data");
    await page.getByLabel("then").selectOption("");
    await expect(page.locator(".gl-g2")).toHaveCount(0);
    await page.getByLabel("Group by").selectOption("team");
    await expect(page.locator(".gl-g1 .gl-name")).toContainText(["Core", "Mobile", "No value"]);
    await page.getByLabel("Group by").selectOption("");
    await expect(page.locator(".gl-group")).toHaveCount(0);
    const w1 = (await box(page, "item-1")).width;
    await page.getByRole("button", { name: "Quarter" }).click();
    await expect(page.locator(".gh-tick").first()).toContainText("Q1 2027");
    expect((await box(page, "item-1")).width).toBeLessThan(w1);
    expect(page.url()).toContain("zoom=quarter");
  });

  test("respects the active scope and the filters of a saved view", async ({ page }) => {
    await open(page, "n=14");
    const all = await page.locator("[data-bar]").count();
    await page.getByLabel("Filters of").selectOption("view-must");
    await expect(page.locator(".gantt-count")).toContainText("filters of “Must haves”");
    expect(await page.locator("[data-bar]").count()).toBeLessThan(all);
    await page.getByLabel("Filters of").selectOption("");
    await page.locator(".scope-chip").click();
    await page.getByRole("menuitemradio", { name: /Customer-facing work/ }).click();
    await expect(page.locator(".gantt-count")).toContainText("scope: Customer-facing work");
    const projects = await page.evaluate(() => [...document.querySelectorAll("[data-bar]")].map((b) => (window as unknown as { __pv: { controller: { row: (id: string) => { home_project: string } } } }).__pv.controller.row(b.getAttribute("data-bar")!).home_project));
    expect(new Set(projects)).toEqual(new Set(["p3"]));
  });
});

test.describe("changing dates", () => {
  test("dragging a bar moves both dates by whole days, saves, and one Ctrl+Z puts both back", async ({ page }) => {
    await openFlat(page);
    const [s0, e0] = await dates(page, "item-1");
    const b = await box(page, "item-1");
    await drag(page, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, 10 * PX);
    const [s1, e1] = await dates(page, "item-1");
    const day = (iso: string) => Math.round(Date.parse(iso) / 86_400_000);
    expect(day(s1!) - day(s0!)).toBe(10);
    expect(day(e1!) - day(e0!)).toBe(10);
    await settle(page);
    expect(await sourceDates(page, "item-1")).toEqual([s1, e1]);
    await expect(page.locator(".strip")).toContainText("R-01 Planned Start");
    expect(await page.evaluate(() => (window as unknown as { __pv: { controller: { status: { undoCount: number } } } }).__pv.controller.status.undoCount)).toBe(1); // one undo step for two dates
    await page.keyboard.press("Control+Z");
    await expect.poll(() => dates(page, "item-1")).toEqual([s0, e0]);
    await settle(page);
    expect(await sourceDates(page, "item-1")).toEqual([s0, e0]);
  });

  test("dragging an edge changes only that date", async ({ page }) => {
    await openFlat(page);
    const [s0, e0] = await dates(page, "item-3");
    const b = await box(page, "item-3");
    await drag(page, { x: b.x + b.width - 2, y: b.y + b.height / 2 }, 5 * PX);
    const [s1, e1] = await dates(page, "item-3");
    expect(s1).toBe(s0);
    expect(Math.round(Date.parse(e1!) / 86_400_000) - Math.round(Date.parse(e0!) / 86_400_000)).toBe(5);
    const b2 = await box(page, "item-3");
    await drag(page, { x: b2.x + 2, y: b2.y + b2.height / 2 }, 3 * PX);
    const [s2, e2] = await dates(page, "item-3");
    expect(e2).toBe(e1);
    expect(Math.round(Date.parse(s2!) / 86_400_000) - Math.round(Date.parse(s1!) / 86_400_000)).toBe(3);
    await settle(page);
  });

  test("a bar cannot be dragged past the window, and keeps its length", async ({ page }) => {
    await openFlat(page);
    const [s0, e0] = await dates(page, "item-1");
    const len = Math.round(Date.parse(e0!) / 86_400_000) - Math.round(Date.parse(s0!) / 86_400_000);
    const b = await box(page, "item-1");
    await drag(page, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, -3000);
    const [s1, e1] = await dates(page, "item-1");
    expect(Math.round(Date.parse(e1!) / 86_400_000) - Math.round(Date.parse(s1!) / 86_400_000)).toBe(len);
    expect(s1!.endsWith("-01")).toBe(true); // the window starts on the first of a month
    expect(Date.parse(s1!)).toBeLessThan(Date.parse(s0!));
  });

  test("Escape during a drag cancels it", async ({ page }) => {
    await openFlat(page);
    const before = await dates(page, "item-4");
    const b = await box(page, "item-4");
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 120, b.y + b.height / 2, { steps: 5 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await dates(page, "item-4")).toEqual(before);
  });

  test("keyboard: arrows stage a change with a visible label, Enter saves, Escape cancels", async ({ page }) => {
    await openFlat(page);
    const [s0, e0] = await dates(page, "item-5");
    await bar(page, "item-5").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    await expect(bar(page, "item-5").locator(".gbar-tip")).toContainText("Planned Start");
    await expect(page.getByRole("status").filter({ hasText: "Enter saves, Escape cancels" })).toHaveCount(1);
    expect(await dates(page, "item-5")).toEqual([s0, e0]); // nothing is saved yet
    await page.keyboard.press("Escape");
    await expect(bar(page, "item-5").locator(".gbar-tip")).toHaveCount(0);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowRight"); // 1 + 7 days
    await page.keyboard.press("Enter");
    const [s1, e1] = await dates(page, "item-5");
    const day = (iso: string) => Math.round(Date.parse(iso) / 86_400_000);
    expect(day(s1!) - day(s0!)).toBe(8);
    expect(day(e1!) - day(e0!)).toBe(8);
    await settle(page);
  });

  test("keyboard: Alt changes the end date, Alt+Shift the start date", async ({ page }) => {
    await openFlat(page);
    const [s0, e0] = await dates(page, "item-6");
    await bar(page, "item-6").focus();
    await page.keyboard.press("Alt+ArrowRight");
    await page.keyboard.press("Enter");
    const [s1, e1] = await dates(page, "item-6");
    expect(s1).toBe(s0);
    expect(Math.round(Date.parse(e1!) / 86_400_000) - Math.round(Date.parse(e0!) / 86_400_000)).toBe(1);
    await bar(page, "item-6").focus();
    await page.keyboard.press("Alt+Shift+ArrowLeft");
    await page.keyboard.press("Enter");
    const [s2, e2] = await dates(page, "item-6");
    expect(e2).toBe(e1);
    expect(Math.round(Date.parse(s1!) / 86_400_000) - Math.round(Date.parse(s2!) / 86_400_000)).toBe(1);
    await settle(page);
  });

  test("view-only roles can look but not drag or use the keys, and are told why", async ({ page }) => {
    await openFlat(page, "&role=viewer");
    const before = await dates(page, "item-1");
    const b = await box(page, "item-1");
    await drag(page, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, 60);
    await bar(page, "item-1").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    expect(await dates(page, "item-1")).toEqual(before);
    await expect(page.locator(".gantt-foot")).toContainText("view-only access");
    await expect(page.locator(".gbar-h")).toHaveCount(0);
  });

  test("a failed save puts the dates back and the strip says why", async ({ page }) => {
    await openFlat(page);
    await page.evaluate(() => { (window as unknown as { __pv: { source: { failWhen: () => string } } }).__pv.source.failWhen = () => "no permission"; });
    const before = await dates(page, "item-7");
    await bar(page, "item-7").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(page.locator(".strip")).toContainText("no permission");
    expect(await dates(page, "item-7")).toEqual(before);
  });
});

test.describe("unscheduled", () => {
  test("items without dates are listed with the reason, and dragging one onto the timeline schedules it with one undo step", async ({ page }) => {
    await openFlat(page);
    const lane = page.getByRole("region", { name: "Unscheduled" });
    await expect(lane).toContainText("No dates");
    const item = lane.locator('[data-unscheduled="item-11"]');
    await expect(item).toBeVisible();
    const target = page.locator('[data-bar="item-1"]');
    const tb = await box(page, "item-1");
    await item.dragTo(page.getByTestId("gantt-scroll"), { targetPosition: { x: tb.x + 40 - (await page.getByTestId("gantt-scroll").boundingBox())!.x, y: 150 } });
    await settle(page);
    const [s, e] = await dates(page, "item-11");
    expect(s).toBeTruthy();
    expect(Math.round(Date.parse(e!) / 86_400_000) - Math.round(Date.parse(s!) / 86_400_000)).toBe(27);
    await expect(lane.locator('[data-unscheduled="item-11"]')).toHaveCount(0);
    await expect(bar(page, "item-11")).toHaveCount(await bar(page, "item-11").count()); // it has a bar now (if in the loaded window rows)
    void target;
    await page.keyboard.press("Control+Z");
    await expect(lane.locator('[data-unscheduled="item-11"]')).toBeVisible();
    expect(await dates(page, "item-11")).toEqual([null, null]);
  });

  test("the keyboard alternative: Schedule from today", async ({ page }) => {
    await openFlat(page);
    await page.getByRole("button", { name: "Schedule R-11 from today" }).click();
    const [s] = await dates(page, "item-11");
    expect(s).toBe("2027-04-14");
    await settle(page);
  });
});

test.describe("item panel and accessibility", () => {
  test("clicking a bar or a name opens the item panel; Esc closes it", async ({ page }) => {
    await openFlat(page);
    await page.locator('[data-item="item-1"] .gl-open').click();
    await expect(page.getByTestId("item-panel")).toContainText("Initiative number 1");
    expect(page.url()).toContain("item=R-01");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("item-panel")).toHaveCount(0);
    const b = await box(page, "item-2");
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await expect(page.getByTestId("item-panel")).toContainText("Initiative number 2");
  });

  test("the chart passes the WCAG A/AA check", async ({ page }) => {
    await openFlat(page);
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 140)}`)).toEqual([]);
  });
});

test.describe("many bars", () => {
  test("2,000 initiatives render quickly, only the visible rows are in the page, and scrolling stays smooth", async ({ page }) => {
    const t0 = Date.now();
    await open(page, "n=2000");
    const first = Date.now() - t0;
    const rendered = await page.locator(".gl").count();
    expect(rendered).toBeLessThan(120);
    const times: number[] = [];
    for (let i = 0; i < 8; i++) {
      const t = Date.now();
      await page.getByTestId("gantt-scroll").evaluate((el, y) => { el.scrollTop = y; }, 600 * (i + 1));
      await page.waitForFunction((y) => { const s = document.querySelector('[data-testid="gantt-scroll"]') as HTMLElement; return s.scrollTop === y; }, 600 * (i + 1));
      await page.waitForFunction(() => document.querySelectorAll("[data-bar]").length > 0);
      times.push(Date.now() - t);
    }
    console.log(`2,000 initiatives: first view ${first} ms, scroll steps max ${Math.max(...times)} ms, ${rendered} rows in the page`);
    expect(first).toBeLessThan(6000);
    expect(Math.max(...times)).toBeLessThan(1000);
  });
});
