---
date: 2026-10-28
by: Claude
request: 233
---
Reports tab, step 2: (1) **Apache ECharts 6.1 (Apache-2.0, SVG renderer, only bar, scatter, custom, grid, tooltip, zoom and mark-line parts imported)** draws Time to Market and the timeline; the four step-1 bar charts stay as accessible HTML. Ashu approved adding it. (2) Every ECharts chart has a "Show as table" with the same numbers, because the library gives no per-bar keyboard access. (3) "By phase" in section 5.2 is read as **days spent in each phase** (a phase's start date to the next start date, the last to G2M Date (actual)), counted for initiatives that have a G2M Date (actual); its bars are not clickable, because "phase" there is not the initiative's current Initiative Phase. Say if you meant Time to Market grouped by current phase. (4) A row with an end before its start is excluded and counted as excluded. (5) Timeline: a bar per phase start date; an open lifecycle runs to G2M Date (est), else today; with no phase dates, Planned Start to G2M Date (est); 30 initiatives at a time with a Show more button. The existing Gantt component is not reused (it edits dates and has its own view logic); only its date helpers are.
