# Gantt (issue #27)

Open **Gantt** in the header (`/gantt`). Phase 2, built on the same items, rules, autosave and undo as the grid.

## What a bar is
- One bar per initiative, from **Planned Start** (`planned_start`) to **G2M Date (est)** (`g2m_date_est`, the dictionary's "Gantt bar"). The darker fill is GitHub delivery progress (empty until phase 3). Text always names the health in the left column ("At Risk"), never only a colour.
- An initiative without both dates, or with G2M before Planned Start, goes to the **Unscheduled** lane under the chart with the reason ("No Planned Start", "No G2M Date (est)", "No dates", "G2M Date (est) is before Planned Start").
- Plan versus actual, dependency lines and PNG/PDF export were added in issue 600 (below). A stored baseline is not built: the plan is the current Planned Start and G2M Date (est).

## Grouping, scope and filters
- **Two levels**, default Initiative Group then project. Pick any other level from the lists: none, Initiative Group, Project, Team, or a select field people edit (Roadmap Category, Initiative Phase, Focus Area, Health, MoSCoW, Horizon, ...). Groups are A to Z with "No value" last; items inside keep their global rank order. Group rows collapse and show their count and a thin span bar. An initiative with several teams appears under each of them when grouped by team.
- Respects the **scope switcher** in the header (`?scope=`) and the **filters of a saved view** (the "Filters of" list; saved views are made in the grid). Settings are in the address (`zoom`, `g1`, `g2`, `view`, `item`).
- **Month** and **Quarter** zoom; **Today** jumps to today; "Show earlier/later months" widen the window. The window starts on the first of a month, covers the bars and today, is at least nine months long and stays put while you work.

## Changing dates
- **Drag** a bar to move both dates, **drag an edge** to change one. Whole days, live preview with the change in words. Release saves (autosave) as **one undo step** for both dates; Esc during a drag cancels.
- **Clamped:** a bar cannot leave the visible window and keeps its length when moved; a bar is at least one day. (Cycles do not exist before phase 5, so the window is the limit.)
- **Keyboard** (focus a bar with Tab): ←/→ move it a day, Shift+←/→ a week, Alt+←/→ change the G2M date, Alt+Shift+←/→ the Planned Start, a day at a time. Changes are **staged** with a visible label ("Planned Start 1 Mar to 8 Mar, G2M Date (est) 31 Mar to 7 Apr"); **Enter** saves, **Esc** cancels. Enter or Space on a bar with no staged change opens the item panel.
- **Unscheduled → timeline:** drag an item from the lane onto the timeline: Planned Start is the day you drop on, G2M Date (est) is four weeks later (an existing later G2M date is kept). Keyboard alternative: **Schedule from today**. One undo step.
- Ctrl+Z / ⌘Z undoes, Shift+Ctrl+Z (or Ctrl+Y) redoes; the strip above the chart shows saving, errors and the Undo button.
- **Read-only:** view-only roles see the chart, cannot drag or use the keys, and the footer says why. If a date field were GitHub-driven it would be locked the same way, with its reason.
- Click a bar or a name to open the **item panel** beside the chart (Esc closes it).

## Performance
Only the rows in view (plus a few) are in the page, so 2,000 initiatives draw in under a second and scroll smoothly (browser test: first view about 0.6 s, scroll steps under 100 ms, about 30 rows in the page).

## Tests
Domain unit tests (`gantt.test.ts`: bars, scale, move, resize, clamp, keys, drop, grouping; `gantt-plan.test.ts`: plan against actual, dependencies and chains, gates, roll-ups, zoom and Fit, multi-move), controller tests for `setDates` and `setManyDates`, and a browser spec (`e2e/gantt.spec.ts`: layout, grouping, scope and filters, drag, edge drag, clamp, Esc, keyboard, view-only, failed save, Unscheduled drop and button, item panel, axe, 2,000 items, hover card, Today marker, overdue and actual line, gates, roll-ups, dependency arrows and chain, zoom, density, column resize, collapse all, PNG export, multi-select).

## Redesign (issue 600, `docs/decisions/2026-11-22-gantt-redesign.md`)
**Reading a bar**
- **Name rule:** the name is inside a bar only when it fits (120 px or more: code and name; 44 px or more: the code; less: nothing). The name stays in view while the bar is scrolled under the name column. **Hover or focus** a bar for a card: plan dates and length, actual start and finish, what that means against the plan, phase, next gate, product manager, effort, teams, delivery progress, dependencies. The bar's screen-reader label says the same in words.
- **Health colours** carry a text label in the name column and on the card. A bar with no Health set is hatched and dashed ("No health set" in the legend). The **legend** under the chart explains every mark.
- **Density:** Compact (28 px rows) or Comfortable (44 px: the name may take two lines and the phase and dependency count show under the health). The choice, and the width of the name column (drag the edge or use the arrows on it), are remembered in the browser.
- **Today** is a marker in the header, not over the bars.

**Plan against actual** (read only; the plan is not stored as a baseline)
- A thin line under the bar runs from Start Date to G2M Date (actual), or to today while it runs (dashed). It turns red when the finish was late or the item is overdue.
- **Overdue N d** beside the bar (and a red end on it): G2M Date (est) has passed, there is no G2M Date (actual) and the Initiative Phase is not Completed or Sunset. "Finished N d late" when it ended after the estimate. The card also says "Started N days late/early" and "Not started, N days after Planned Start".
- A **diamond with the gate letter** shows Next Gate Due; hover it for the gate and its status. It never moves a gate.

**Group rows** show at-risk, late and blocked counts (Health At Risk, Blocked; late from the dates) and the average delivery progress of the items that have it, and the thin span bar is filled to that progress. Team level only.

**Dependencies** come from **Depends On** only. An arrow runs from the end of what must finish to the start of what waits for it. Red arrow and "N early" in the name column: the dependent starts before what it waits for ends. Hover or focus a bar to light its whole chain (everything it waits for and everything waiting for it) and fade the rest. Dependencies with no bar in the view are named on the card and not drawn.

**Zoom and navigation:** Week, Month, Quarter and Year; **Fit** picks the finest that shows the whole timeline; **Ctrl/⌘ + scroll** zooms around the middle of the screen; **Collapse all / Expand all** for the groups.

**Several bars at once:** Shift-click (or Ctrl/⌘-click, or press **S** on a focused bar) to select; dragging one selected bar moves them all by the same days, stopping at the window edge, saved as **one undo step** ("Moved N items on the Gantt"). Keyboard: arrows on a selected bar stage the move for all of them, Enter saves; or use "Move 1 week earlier/later" in the strip above the chart. Esc clears the selection.

**Export:** Export PNG downloads a picture of every row (not only the rows in view); Export PDF opens the print window on the same picture (choose Save as PDF). A chart taller than 16,000 px is refused with a reason: filter or collapse first.

Not built: saved Gantt settings in a saved view, a Timeline section in the item panel, mobile layout, tracker "blocked by" arrows.
