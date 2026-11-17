---
date: 2026-11-17
by: Ashu, Claude
request: 472
---
**The Changes report is a fourth report on the Reports tab, over the audit log; PM flags are new reasons in Needs attention, not a second system.** Ashu asked for it (and for actor names on each row) on 2026-11-17. Choices made without asking, change them if you disagree: the source is `audit_log` through the member-readable function `change_feed` (no new table, the audit table stays admin-only); the "exact time" is when Product Velocity registered the change, and the tracker's own time per change is not shown because only the latest one is stored; actors are shown as the workspace email (the only name the directory holds); no counts or charts per person (rule 8); commercial fields and gate decisions are left out; flags are suggestions only. The R-27 case (every linked issue or epic closed while the phase is still Build) widens "Build done" so it also fires when Build Status has not caught up. New reasons: Completed with open work, Phase ahead of the build, Stale issues, No health set. GitHub and Jira are covered together (tracker parity). Documented in `docs/28-DECISION-GATES.md` sections 7a and 7c and the Help page.
