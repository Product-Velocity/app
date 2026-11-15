---
issue: 431
status: open
logged: 2026-11-13
title: Tracker initiative level over many epics, orphan-epic linking and the "Roadmap with epics" Excel report
---
Ashu, 2026-11-13, after matching 54 Jira epics to the Refinery89 business roadmap (`Refinery_Roadmap_v31.xlsx`): set up the Initiative level in Jira and link those initiatives to the initiatives in Product Velocity; read initiative -> epic -> story as one tree (the epic status tells enough about progress; stories and tasks only if easy); populate the initiative in Product Velocity (description, tags, links, status) and use the epics for build status. She wants to download the exact report of sheet 1 from Product Velocity once the tree exists. Decided (`docs/decisions/2026-11-13-tracker-initiative-level.md`): Product Velocity owns the lifecycle fields, and a change made in Jira comes back in the two-way sync flagged, never silently; initiatives can be created in either place; a way to find orphan epics and link or create their initiative, then send it to Jira, is wanted (second slice).

**Ashu triggers the clearing of the existing epics in Product Velocity herself, by a separate explicit request. Do not delete, archive or relink them as part of this request.**

Progress: spike J2 proven on the Refinery89 site (2026-11-15, `docs/08`); the Excel report (slice 1) and the Jira tree read above Epic (slice 2: Build Status, dates and roll-up from the epics) are built; GitHub parity is #453; the Test connection page with saved results is #452 (own session). Slice 3 (the mapping shows each type's level) and slice 4 (epic keys at creation: the epics are listed on the initiative and linked by Sync with Jira after confirmation) are built. Still open: orphan epics (a list of epics with no Initiative parent), an undo screen for a moved epic, linking an existing initiative to an existing Jira issue (not needed for the fresh start: Initiatives are created in Jira and pulled in), and the GitHub twins.

First step (done): spike J2 on the Refinery89 Jira site. Product Velocity initiative: group "Delivery platform sync fields expansion".
