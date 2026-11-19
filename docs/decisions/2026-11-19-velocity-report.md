---
date: 2026-11-19
by: Ashu
request: 545
---
**The Velocity report counts the time to roll-out and is team-level only.** Decided while reviewing the prototype (`prototype/project/Velocity-report.html`, PR #544):

- **Total** is Start Discovery to Start Roll-Out. The 30, 60 and 90 days after roll-out up to Completed are left out. Gate C approval starts the roll-out, so To Gate C and Total end close together. The other measures are To Gate A, To Gate B (optionally from Gate A), To Gate C (optionally from Gate B) and Build (Start Building to Start Test).
- **One Key Result per initiative** (the Primary KR, `kr_metric`), as an initiative has one Objective and one Business Line today. An initiative with several teams counts once per team, as in the other reports.
- **Decisions are shown for the team as a whole**, never per approver (rule 8). No individual performance metrics.
- **The shared filter bar** gains Objective, Key Result, Business Line and Initiative Status, so every report gets them. Initiative Group, Focus Area and Planned Quarter are already there. There is no "Finished in" filter: Planned Quarter combined with Initiative Status covers it.
- **No generated insights text in the app**, because Product Velocity is not connected to an AI. The report shows the numbers; a person can ask their own Claude through the MCP server. The instructions for the connected Claude (discovery, product requirements documents, reporting, more later) are to be set for the platform as a whole, not per workspace, visible to people and adapted where needed. Where they are shown and who may change them is settled in that separate request.
- **Not added to this report:** scope added after commit, estimate against actual (already in Build time on Overview) and blocked days.
- **Inside the platform all fields are allowed (revised by Ashu, 2026-11-19).** Key Result (the Primary KR, `kr_metric`) is used as a filter and a break-down in the Reports tab, and the same holds for any field in any report in the app. The commercial-fields rule (rule 2) is about what leaves the platform: nothing commercial goes to GitHub or Jira, and customer-safe reports stay customer-safe. The fixed column list of the Reports grid and CSV export is unchanged by this decision.
