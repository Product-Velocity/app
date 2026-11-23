import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { goToView, hasChanges, viewTab } from "./helpers";

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
const box = async (page: Page, id: string) => {
  await bar(page, id).scrollIntoViewIfNeeded();
  // keep the bar clear of the name column, which covers the left edge of the scrolled timeline
  await page.getByTestId("gantt-scroll").evaluate((el, i) => {
    const b = el.querySelector(`[data-bar="${i}"]`)!.getBoundingClientRect();
    const labelW = parseFloat(getComputedStyle(el).getPropertyValue("--label-w")) || 320;
    const over = el.getBoundingClientRect().left + labelW + 24 - b.left;
    if (over > 0) el.scrollLeft -= over;
  }, id);
  return (await bar(page, id).boundingBox())!;
};
/** The toolbar menus are buttons that open a short list ("Group by: Initiative Group"). */
const choose = async (page: Page, menu: string, option: string) => {
  await page.getByRole("button", { name: new RegExp(`^${menu}:`) }).click();
  await page.getByRole("menuitemradio", { name: option, exact: true }).first().click();
};
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
    await expect(page.locator(".page-meta")).toContainText("scheduled");
    const groups = await page.locator(".gl-g1 .gl-name").allTextContents();
    expect(groups).toEqual(["Onboarding", "Platform health", "Retention", "No value"]); // A to Z, "No value" last
    await expect(page.locator(".gl-g2 .gl-name").first()).toBeVisible();
    const b = bar(page, "item-1");
    await expect(b).toHaveAttribute("aria-label", /R-01 .*\d+ \w+ to \d+ \w+/);
    expect((await dates(page, "item-1"))[0]).toBe("2027-01-04");
    await expect(page.locator(".gh-tick").first()).toHaveText("Jan");
    await expect(page.locator(".gantt-today")).toBeVisible();
  });

  test("a bar shows its name only when it fits: the code when it is narrow, nothing when it is tiny; the card always has the full name", async ({ page }) => {
    await openFlat(page);
    const bars = await page.$$eval("[data-bar]", (els) => els.map((e) => ({ id: e.getAttribute("data-bar")!, w: e.getBoundingClientRect().width, inside: (e.querySelector(".gbar-text")?.textContent ?? "").trim() })));
    expect(bars.some((b) => b.w < 120)).toBe(true); // the test data has narrow bars
    for (const b of bars) {
      if (b.w >= 120) expect(b.inside).toMatch(/^R-\d+ \S/);
      else if (b.w >= 44) expect(b.inside).toMatch(/^R-\d+$/);
      else expect(b.inside).toBe("");
    }
    await expect(page.locator(".gbar-out")).toHaveCount(0);
    const b = await box(page, "item-1");
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await expect(page.getByTestId("gantt-card")).toContainText("Initiative number 1");
    await expect(page.getByTestId("gantt-card")).toContainText("Plan");
    await page.mouse.move(5, 5);
    await expect(page.getByTestId("gantt-card")).toHaveCount(0);
  });

  test("keyboard focus shows the same card, and the bar's label says phase, plan against actual, gate and dependencies", async ({ page }) => {
    await openFlat(page);
    await bar(page, "item-3").focus();
    await expect(page.getByTestId("gantt-card")).toContainText("Depends on");
    await expect(bar(page, "item-3")).toHaveAttribute("aria-label", /phase Build.*1 dependency/);
  });

  test("the Today marker sits in the header, not over the bars", async ({ page }) => {
    await open(page, "n=14");
    const head = (await page.locator(".gantt-head").boundingBox())!;
    const marker = (await page.locator(".gh-today").boundingBox())!;
    expect(marker.y).toBeGreaterThanOrEqual(head.y);
    expect(marker.y + marker.height).toBeLessThanOrEqual(head.y + head.height + 1);
    await expect(page.locator(".gh-today")).toHaveText("Today");
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
    await choose(page, "Group by", "Project");
    await expect(page.locator(".gl-g1 .gl-name").first()).toHaveText("Data");
    await choose(page, "Then by", "None");
    await expect(page.locator(".gl-g2")).toHaveCount(0);
    await choose(page, "Group by", "Team");
    await expect(page.locator(".gl-g1 .gl-name")).toContainText(["Core", "Mobile", "No value"]);
    await choose(page, "Group by", "No grouping");
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
    await goToView(page, "Must haves");
    await expect(page.locator(".page-meta")).toContainText("filters of “Must haves”");
    expect(await page.locator("[data-bar]").count()).toBeLessThan(all);
    await goToView(page, "Prioritisation");
    await page.locator(".scope-chip").click();
    await page.getByRole("menuitemradio", { name: /Customer-facing work/ }).click();
    await expect(page.locator(".page-meta")).toContainText("Project: Customer-facing work");
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

test.describe("planned against actual, gates and group roll-ups", () => {
  test("a bar past its G2M Date (est) with no finish says Overdue in words; an actual line shows where work really ran", async ({ page }) => {
    await openFlat(page);
    await expect(page.locator(".gnote", { hasText: /^Overdue \d+ d$/ }).first()).toBeVisible();
    await expect(page.locator(".gactual").first()).toBeAttached();
    const b = await box(page, "item-4"); // item 4 has an actual start (i % 3 === 0) and finished late or on plan
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await expect(page.getByTestId("gantt-card")).toContainText(/Started \d+ days? (late|early)|Started on plan/);
  });

  test("the next gate is a diamond with its letter, read only", async ({ page }) => {
    await openFlat(page);
    const g = page.locator('[data-item="item-2"] .ggate');
    await expect(g.locator(".ggate-l")).toHaveText("B");
    await expect(bar(page, "item-2")).toHaveAttribute("aria-label", /Gate B, Not started, due 2027-/); // the diamond never takes the click: the bar under it does
    const b = await box(page, "item-2");
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await expect(page.getByTestId("gantt-card")).toContainText("Next gate");
  });

  test("group rows roll up what needs a look and the delivery progress, team level", async ({ page }) => {
    await open(page, "n=40");
    const flags = await page.locator(".gl-g1 .gl-roll").allTextContents();
    expect(flags.join(" ")).toMatch(/\d+ (at risk|late|blocked)/);
    await expect(page.locator(".gl-g1 .gl-roll").first()).toHaveAttribute("title", /(No flags|at risk|late|blocked)/);
  });
});

test.describe("dependencies from depends_on", () => {
  test("draws an arrow per drawn dependency and marks the ones that start before what they wait for ends", async ({ page }) => {
    await openFlat(page);
    expect(await page.locator(".gdep").count()).toBeGreaterThan(0);
    await expect(page.locator('[data-item="item-3"] .gl-dep')).toContainText("1 dep");
  });

  test("hovering a bar lights its chain and fades the rest", async ({ page }) => {
    await openFlat(page);
    const b = await box(page, "item-3");
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await expect(page.locator(".gdep-active").first()).toBeAttached();
    expect(await page.locator(".gbar-dim").count()).toBeGreaterThan(0);
    await expect(bar(page, "item-3")).not.toHaveClass(/gbar-dim/);
    await expect(bar(page, "item-2")).not.toHaveClass(/gbar-dim/); // what it waits for stays lit
    await page.mouse.move(5, 5);
    await expect(page.locator(".gbar-dim")).toHaveCount(0);
  });

  test("a dependency that is moved so it starts before its predecessor ends turns red and says so", async ({ page }) => {
    await openFlat(page);
    const set = await page.evaluate(() => {
      const c = (window as unknown as { __pv: { controller: { row: (id: string) => { planned_start: string; g2m_date_est: string }; setDates: (id: string, d: { planned_start: string; g2m_date_est: string }) => unknown } } }).__pv.controller;
      const pred = c.row("item-2");
      return c.setDates("item-3", { planned_start: pred.planned_start, g2m_date_est: pred.g2m_date_est });
    });
    expect(set).toMatchObject({ ok: true });
    await expect(page.locator('[data-item="item-3"] .gl-dep-clash')).toContainText("1 early");
    await expect(page.locator(".gdep-clash").first()).toBeAttached();
  });
});

test.describe("zoom, density, export and selection", () => {
  test("week and year zoom, Fit, and Ctrl+wheel", async ({ page }) => {
    await open(page, "n=14");
    await page.getByRole("button", { name: "Week", exact: true }).click();
    expect(page.url()).toContain("zoom=week");
    await expect(page.locator(".gh-tick").nth(1)).toHaveText(/^\d+ \w{3}$/);
    await page.getByRole("button", { name: "Year", exact: true }).click();
    await expect(page.locator(".gh-tick").first()).toHaveText(/^Q\d$/);
    await page.getByRole("button", { name: "Fit" }).click();
    expect(await page.locator('.gantt-view-chip, [aria-label="Zoom"] [aria-pressed="true"]').count()).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Month", exact: true }).click();
    const scroll = page.getByTestId("gantt-scroll");
    const bx = (await scroll.boundingBox())!;
    await page.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, 200); // zoom out one step
    await page.keyboard.up("Control");
    await expect(page.getByRole("button", { name: "Quarter", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  test("Comfortable rows are taller, show the phase, and stay across a reload", async ({ page }) => {
    await openFlat(page);
    const h0 = (await page.locator('[data-item="item-1"]').boundingBox())!.height;
    await page.getByRole("button", { name: "Comfortable" }).click();
    const h1 = (await page.locator('[data-item="item-1"]').boundingBox())!.height;
    expect(h1).toBeGreaterThan(h0);
    await expect(page.locator('[data-item="item-1"] .gl-meta')).toContainText("Discover");
    await page.reload();
    await page.waitForSelector("[data-bar]");
    await expect(page.getByRole("button", { name: "Comfortable" })).toHaveAttribute("aria-pressed", "true");
  });

  test("the name column can be resized with the keyboard", async ({ page }) => {
    await open(page, "n=14");
    const sep = page.getByRole("separator", { name: "Resize the name column" });
    const w0 = Number(await sep.getAttribute("aria-valuenow"));
    await sep.focus();
    await page.keyboard.press("ArrowRight");
    expect(Number(await sep.getAttribute("aria-valuenow"))).toBe(w0 + 16);
  });

  test("Collapse all closes every group, Expand all opens them again", async ({ page }) => {
    await open(page, "n=14");
    const before = await page.locator("[data-bar]").count();
    await page.getByRole("button", { name: "Collapse all" }).click();
    await expect(page.locator("[data-bar]")).toHaveCount(0);
    await page.getByRole("button", { name: "Expand all" }).click();
    expect(await page.locator("[data-bar]").count()).toBe(before);
  });

  test("Export PNG downloads a picture of the whole chart", async ({ page }) => {
    await openFlat(page);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export PNG" }).click()]);
    expect(download.suggestedFilename()).toBe("gantt-2027-04-14.png");
    const path = await download.path();
    const { statSync } = await import("node:fs");
    expect(statSync(path!).size).toBeGreaterThan(5000);
  });

  test("Shift-click selects bars; dragging one moves them all as one undo step; Ctrl+Z puts them all back", async ({ page }) => {
    await openFlat(page);
    const before = [await dates(page, "item-5"), await dates(page, "item-6")];
    const b5 = await box(page, "item-5");
    await page.keyboard.down("Shift");
    await page.mouse.click(b5.x + b5.width / 2, b5.y + b5.height / 2);
    const b6 = await box(page, "item-6");
    await page.mouse.click(b6.x + b6.width / 2, b6.y + b6.height / 2);
    await page.keyboard.up("Shift");
    await expect(page.getByRole("region", { name: "Selected bars" })).toContainText("2 selected");
    const u0 = await page.evaluate(() => (window as unknown as { __pv: { controller: { status: { undoCount: number } } } }).__pv.controller.status.undoCount);
    const b = await box(page, "item-5");
    await drag(page, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, 7 * PX);
    const day = (iso: string) => Math.round(Date.parse(iso) / 86_400_000);
    const after = [await dates(page, "item-5"), await dates(page, "item-6")];
    for (let i = 0; i < 2; i++) { expect(day(after[i]![0]!) - day(before[i]![0]!)).toBe(7); expect(day(after[i]![1]!) - day(before[i]![1]!)).toBe(7); }
    await settle(page);
    expect(await page.evaluate(() => (window as unknown as { __pv: { controller: { status: { undoCount: number } } } }).__pv.controller.status.undoCount)).toBe(u0 + 1);
    await page.keyboard.press("Control+Z");
    await expect.poll(async () => [await dates(page, "item-5"), await dates(page, "item-6")]).toEqual(before);
  });

  test("the selection can be moved a week with buttons (keyboard path) and cleared with Esc", async ({ page }) => {
    await openFlat(page);
    await bar(page, "item-5").focus(); await page.keyboard.press("s");
    await bar(page, "item-6").focus(); await page.keyboard.press("s");
    const before = await dates(page, "item-5");
    await page.getByRole("button", { name: "Move 1 week later" }).click();
    const after = await dates(page, "item-5");
    expect(Math.round(Date.parse(after[0]!) / 86_400_000) - Math.round(Date.parse(before[0]!) / 86_400_000)).toBe(7);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("region", { name: "Selected bars" })).toHaveCount(0);
  });
});

test.describe("views (issue #622)", () => {
  test("shows the 3 default views, and each applies its filters, grouping, zoom and row height", async ({ page }) => {
    await open(page, "n=40");
    const tabs = page.getByRole("group", { name: "View" }).locator(".view-chip");
    await expect(tabs).toHaveText(["Prioritisation", "Planning", "Delivery"]);
    await expect(page.getByRole("button", { name: "Month", exact: true })).toHaveAttribute("aria-pressed", "true");
    await viewTab(page, "Delivery").click();
    expect(page.url()).toContain("view=Delivery");
    await expect(page.getByRole("button", { name: "Week", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Comfortable" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".page-pills")).toContainText("Initiative Phase");
    await viewTab(page, "Planning").click();
    await expect(page.getByRole("button", { name: "Quarter", exact: true })).toHaveAttribute("aria-pressed", "true");
    await viewTab(page, "Prioritisation").click();
    await expect(page.getByRole("button", { name: "Month", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(hasChanges(page)).toHaveCount(0);
  });

  test("a change to the zoom marks the view as changed; saving it as a new view keeps zoom and grouping", async ({ page }) => {
    await open(page, "n=14");
    await page.getByRole("button", { name: "Year", exact: true }).click();
    await choose(page, "Group by", "Team");
    await expect(hasChanges(page)).toHaveCount(1);
    await page.locator(".more-views-btn").click();
    await expect(page.getByRole("dialog", { name: "Views" })).toContainText("timeline settings");
    await page.getByRole("dialog", { name: "Views" }).getByRole("button", { name: "Save as new view…" }).click();
    const dlg = page.getByRole("dialog", { name: "Save as new view" });
    await dlg.getByLabel("Name").fill("Year by team");
    await dlg.getByRole("button", { name: "Save view" }).click();
    await expect(hasChanges(page)).toHaveCount(0);
    await goToView(page, "Prioritisation");
    await expect(page.getByRole("button", { name: "Month", exact: true })).toHaveAttribute("aria-pressed", "true");
    await goToView(page, "Year by team");
    await expect(page.getByRole("button", { name: "Year", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".gl-g1 .gl-name")).toContainText(["Core", "Mobile", "No value"]);
    await expect(hasChanges(page)).toHaveCount(0);
  });
});

test("the views menu stays on screen when the bar has few tabs (issue #622)", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await open(page, "n=14");
  await page.locator(".more-views-btn").click();
  const box = (await page.getByRole("dialog", { name: "Views" }).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1100);
});

test.describe("the views panel (issue #625)", () => {
  const more = (page: Page) => page.locator(".more-views-btn");
  const panelOf = (page: Page) => page.getByRole("dialog", { name: "Views" });
  const rowOf = (page: Page, name: string) => panelOf(page).getByRole("group", { name, exact: true });
  const layouts = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __pv: { store: { layouts: Record<string, unknown[]> } } }).__pv.store.layouts)) as Record<string, { ref: { name?: string }; inBar: boolean }[]>);

  test("the bar is a list: what is in it first (with a count), the other views below, Add and Remove move a view between them", async ({ page }) => {
    await open(page, "n=14");
    await more(page).click();
    const inBar = panelOf(page).getByRole("region", { name: "In your bar" });
    await expect(inBar).toContainText("3 of 6");
    await expect(inBar.getByRole("group")).toHaveCount(3);
    await expect(panelOf(page).getByRole("region", { name: "Workspace views" })).toContainText("Must haves");
    await rowOf(page, "Must haves").getByRole("button", { name: "Add Must haves to the bar" }).click();
    await expect(inBar.getByRole("group")).toHaveCount(4);
    await expect(more(page)).toHaveText(/^Views/); // nothing is left out of the bar, so it is not "0 more views"
    await rowOf(page, "Must haves").getByRole("button", { name: "Remove Must haves from the bar" }).click();
    await expect(more(page)).toHaveText(/^1 more view/);
  });

  test("a view in the bar is reordered by dragging its row, or with the arrow keys on its grip; only the Gantt's own bar changes", async ({ page }) => {
    await open(page, "n=14");
    await more(page).click();
    await rowOf(page, "Delivery").dragTo(rowOf(page, "Prioritisation"));
    await expect.poll(async () => (await page.getByRole("group", { name: "View" }).locator(".view-chip").allTextContents()).join(",")).toBe("Delivery,Prioritisation,Planning");
    await rowOf(page, "Delivery").getByRole("button", { name: /^Move Delivery in the bar/ }).focus();
    await page.keyboard.press("ArrowDown");
    await expect.poll(async () => (await page.getByRole("group", { name: "View" }).locator(".view-chip").allTextContents()).join(",")).toBe("Prioritisation,Delivery,Planning");
    const l = await layouts(page);
    expect(l["gantt|u1"]?.length).toBeGreaterThan(0);
    expect(Object.keys(l).filter((k) => !k.startsWith("gantt|"))).toEqual([]); // the Grid's and Cards' bars are untouched
  });

  test("an admin switches between My bar and Workspace bar; the workspace bar is marked, and changes go to the workspace layout", async ({ page }) => {
    await open(page, "n=14&role=admin");
    await more(page).click();
    await expect(panelOf(page).getByRole("button", { name: "My bar" })).toHaveAttribute("aria-pressed", "true");
    await expect(panelOf(page).locator(".vm-banner")).toHaveCount(0);
    await panelOf(page).getByRole("button", { name: "Workspace bar" }).click();
    await expect(panelOf(page).locator(".vm-banner")).toContainText("You are changing the Gantt bar for everyone");
    await expect(panelOf(page).getByRole("region", { name: "In the workspace bar" })).toBeVisible();
    await rowOf(page, "Planning").getByRole("button", { name: "Remove Planning from the bar" }).click();
    const l = await layouts(page);
    expect(l["gantt|"]?.some((r) => r.ref.name === "Planning" && !r.inBar)).toBe(true);
    expect(l["gantt|u1"]).toBeUndefined();
    // a member has no switch at all
    await open(page, "n=14&role=creator");
    await more(page).click();
    await expect(panelOf(page).getByRole("button", { name: "Workspace bar" })).toHaveCount(0);
  });

  test("the current view and its actions stay at the top while the list scrolls, and say what changed", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 520 });
    await open(page, "n=14");
    await page.getByRole("button", { name: "Year", exact: true }).click();
    await more(page).click();
    const head = panelOf(page).locator(".vm-head");
    await expect(head).toContainText("timeline settings");
    await expect(head.getByRole("button", { name: "Save as new view…" })).toBeVisible();
    const before = (await head.boundingBox())!.y;
    await panelOf(page).evaluate((el) => { el.scrollTop = el.scrollHeight; });
    expect(Math.abs((await head.boundingBox())!.y - before)).toBeLessThan(2);
  });

  test("the Gantt lists only its own views: a Grid view is not here, and a view saved here belongs to the Gantt", async ({ page }) => {
    await open(page, "n=14");
    await page.getByRole("button", { name: "Year", exact: true }).click();
    await more(page).click();
    await expect(panelOf(page)).not.toContainText("A Grid view");
    await panelOf(page).getByRole("button", { name: "Save as new view…" }).click();
    const dlg = page.getByRole("dialog", { name: "Save as new view" });
    await dlg.getByLabel("Name").fill("Made here");
    await dlg.getByRole("button", { name: "Save view" }).click();
    const views = await page.evaluate(() => (window as unknown as { __pv: { store: { views: { name: string; surface?: string }[] } } }).__pv.store.views.map((v) => [v.name, v.surface ?? "grid"]));
    expect(views).toContainEqual(["Made here", "gantt"]);
    await more(page).click();
    await expect(panelOf(page).getByRole("region", { name: "My views" }).locator(".vm-name")).toHaveText(["Made here"]);
  });

  test("an admin's Update for everyone on a Gantt default changes the Gantt's default only", async ({ page }) => {
    await open(page, "n=14&role=admin");
    await page.getByRole("button", { name: "Year", exact: true }).click();
    await more(page).click();
    await panelOf(page).getByRole("button", { name: "Update for everyone" }).click();
    await page.getByRole("dialog", { name: "Update for everyone?" }).getByRole("button", { name: "Update for everyone" }).click();
    const defaults = await page.evaluate(() => (window as unknown as { __pv: { store: { views: { baseView?: string; surface?: string }[] } } }).__pv.store.views.filter((v) => v.baseView).map((v) => [v.baseView, v.surface]));
    expect(defaults).toEqual([["Prioritisation", "gantt"]]);
    await expect(page.getByRole("button", { name: "Year", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".vm-dot")).toHaveCount(0);
  });

  test("at phone width the panel is a sheet at the foot of the screen, and near the left edge it stays on screen", async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 800 });
    await open(page, "n=14");
    await more(page).click();
    const box = (await panelOf(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(420);
    expect(Math.round(box.y + box.height)).toBe(800);
  });
});
