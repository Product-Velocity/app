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
- **Key Result is a commercial field, shown inside the app only.** It is the Primary KR (Metric Name), one value per initiative, used as a filter and a break-down in the Reports tab, which is for workspace members. The names of Key Results appear in filters, pills and charts of that tab. The Reports grid and CSV column list still has no commercial field, and nothing here is sent to GitHub, Jira or a customer-facing report (rule 2).
