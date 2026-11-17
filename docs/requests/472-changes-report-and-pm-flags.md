---
issue: 472
status: in progress
logged: 2026-11-17
title: Changes report and PM action flags
---
"I want to create a report or an insights screen that I can easily see what initiatives have changed and what was changed. Today, this week, this month. Filtered for change types and grouped by initiatives. For each I also need the exact time we registered it. I need to understand if it changed the status or phase or health of the initiative next to the status changes in underlying connected issues." Then: show the actor names; and add flags for the PM to act on, for example R-27 is flagged because all linked epics are done but the status is still in progress. Built as the Changes report (Reports) and four new reasons plus a wider Build done in Needs attention. See docs/decisions/2026-11-17-changes-report.md.

Follow-up, 2026-11-17: "I would like the information to sit on an ag grid. With grouping and color coding with regards to update types and flags to follow up." Done in the same request (decision update above).

Follow-up, 2026-11-17 (after testing): the initiative name did not open the details panel; show the Jira or GitHub issue name and ID with a link; add the flags as well. Done, see the decision update.

Follow-up, 2026-11-17 (after the review): fix review items 1 to 3 including the main grid; use the Roadmap grid's action bar (filter, columns, grouping, search) above the report, adapted; rename the column Source to "Source type" and add "Source" (Product Velocity, Jira, GitHub) in front of it. A third request was cut off ("3.") and is open: ask Ashu.

Follow-up, 2026-11-17 (after R-72): "Yes, I want it" (one row for a Jira or GitHub move instead of two) "and record the Jira user name as well and show it as a column". Done; the name is read from Jira's history and is personal data (go-live checklist).
