---
date: 2026-11-23
by: Ashu (request in chat, 2026-11-23), built by Claude
request: 628
---
**A sixth report, OKRs, on the Reports tab.** Three views, from the examples Ashu pasted (Overview of objectives by business line, items per OKR by quarter, OKR phases for the current quarter):

- **Objectives by Business Line:** a table grouped by Business Line (`business_line`), one row per Objective (`okr_objective`) with Focus Area, Owner (`sponsor`), Business Value Type and the initiative count; largest first, "Not set" last. The two fields are independent (decision 2026-11-17), so an Objective can sit under several Business Lines and the counts always add up to the initiatives shown.
- **Initiatives per Objective by planned quarter:** clustered bars, one per Planned Quarter (`g2m_quarter`), quarters in time order, "Unscheduled" last, so a change of focus shows between quarters.
- **Objectives by Phase for the current quarter:** the quarter is today's calendar quarter (Q4 2026 on 2026-11-23); the rows are the initiatives planned for it, split by Initiative Phase.
- Same filters, click-to-filter pills, peek panel, PNG and PDF export as the other reports. Read only; nothing is written and nothing leaves the platform.

**Not built, and why:** the example's "Requests" column (open feature requests mapped to an objective) has no field in the data model, so it is left out; the objectives carry no O1..O8 number (decision 2026-11-17: "the objective is written in full, with no separate number"), so rows use the full text. The fourth bullet of the request was empty.
