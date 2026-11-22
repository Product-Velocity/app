---
date: 2026-11-22
by: Ashu ("baseline planned vs actual only. Dependency on depends. Do 1 to 5 in 1 go"), built by Claude
request: 600
status: built, to confirm
---
**The Gantt gets the same treatment as the cards: clearer bars, more on each bar, and the pieces connected.** No migration.

- **Planned against actual only, no stored baseline.** The plan is Planned Start and G2M Date (est) as they are now. The actual is Start Date and G2M Date (actual) (both already tracker-derived, GitHub and Jira alike). The chart says how far apart they are ("Started 3 days late", "Finished 5 days early") and "Overdue N d" when G2M Date (est) has passed with no finish and the phase is not Completed or Sunset. A later "it slipped from the original date" needs a baseline table; not built.
- **Dependencies come from `depends_on` only**, not from a tracker's "blocked by". Arrows go from what must finish to what waits for it; an arrow turns red (and the row says "N early") when the dependent starts before the predecessor ends. A dependency with no bar in the view (not scheduled, filtered out) is named on the hover card and not drawn.
- **Read only on purpose.** Gate diamonds show the next gate date and letter; the Gantt never moves a gate (rule 3) and never writes a tracker-driven field (rule 6). Group roll-ups ("2 at risk, 1 late", progress) are team-level (rule 8).
- **Late means dates, not feelings.** At Risk and Blocked are the Health people set; late is computed from the dates.
- **Parity.** Delivery progress and the actual dates arrive through the same fields from GitHub and Jira, so the chart treats them alike.
- **Not built, said plainly:** saved Gantt settings in a saved view, the details panel section "Timeline", a mobile layout, and a "blocked by" arrow from trackers.
