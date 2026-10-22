# Gantt (issue #27)

Open **Gantt** in the header (`/gantt`). Phase 2, built on the same items, rules, autosave and undo as the grid.

## What a bar is
- One bar per initiative, from **Planned Start** (`planned_start`) to **G2M Date (est)** (`g2m_date_est`, the dictionary's "Gantt bar"). The darker fill is GitHub delivery progress (empty until phase 3). Text always names the health in the left column ("At Risk"), never only a colour.
- An initiative without both dates, or with G2M before Planned Start, goes to the **Unscheduled** lane under the chart with the reason ("No Planned Start", "No G2M Date (est)", "No dates", "G2M Date (est) is before Planned Start").
- Start Date (`start_date`, work actually started) and the actual dates are not drawn yet: plan versus actual arrives with GitHub data (phase 3). Dependency lines, a baseline and PNG/PDF export (shown on the prototype board) are not part of this issue.

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
Domain unit tests (`gantt.test.ts`: bars, scale, move, resize, clamp, keys, drop, grouping), controller tests for `setDates`, and a browser spec (`e2e/gantt.spec.ts`: layout, grouping, scope and filters, drag, edge drag, clamp, Esc, keyboard, view-only, failed save, Unscheduled drop and button, item panel, axe, 2,000 items).
