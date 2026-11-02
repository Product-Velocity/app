---
date: 2026-11-02
by: Ashu, Claude
request: 287
---
**Reports tab gets a list of reports; the second is Roadmap Health (R-129, issue #287).** Ashu approved the recommended definitions of the PRD's Phase 0:

- **Report list.** "Overview" (the existing report, unchanged) and "Roadmap Health" sit next to the Reports title like the views next to Roadmap in the Grid tab. The first opens by default; the other is `?report=health`. Filters, pills and toggles are shared, so they stay when switching.
- **Active** = Initiative Status is Active (not On hold, Completed or Cancelled).
- **Needs attention** = Health Blocked, At Risk or Delayed, shown as three separate counts (the PRD names only Blocked and At Risk; Delayed is a Health value too and is not hidden). Clicking a count filters like any chart.
- **Days in current phase** = today minus the start date of the current phase (Start Discovery ... Start Roll-Out), else the day of Phase Changed At. **Age** = today minus Start Date, else Planned Start. An empty, invalid or future date counts as "no date": it is disclosed (count in the summary, "No date" in the list) and never silently dropped (FR-1.3).
- **Completed delivery duration** reuses Time to Market (median, average, distribution, sample size, exclusions) for initiatives whose Initiative Status is Completed.
- Phase x Team and Health x Team show active initiatives; a multi-team initiative counts once per team, said on the chart (FR-1.5).
- No commercial field is used; the page edits nothing and follows the same visibility as the Overview report today. No export in V1 (the PRD makes it optional). Performance (FR-1.11): the aggregations are tested at 1,000 initiatives (well under 100 ms).
