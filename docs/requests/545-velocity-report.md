---
issue: 545
status: in progress
logged: 2026-11-19
title: Velocity report: time to roll-out, gates and sub-phases
---
Ashu, 2026-11-19: "The core of product velocity is to make things move faster, this is the reason why we are tracking all the dates. I want to build a report that focusses on velocity and provides insights that are actionable." Median and average of the build phase were not enough; wanted a bell chart with the average and the buckets of faster and slower times, by T-shirt size, Team, Key Result, Objective and Business Line, for total time, to Gate A, B and C and to roll-out, plus time to decide per gate and time in each sub-phase of development. A clickable prototype came first (`prototype/project/Velocity-report.html`, draft PR #544), was reviewed in comments and approved ("happy with the prototype, lets build this").

Decisions taken in the review are in `docs/decisions/2026-11-19-velocity-report.md`. Built as a fifth report in Reports (Velocity), with Objective, Key Result, Business Line and Initiative Status added to the shared filter bar.

Not part of this request: generated insights text and the platform-wide AI instructions for the connected Claude (discovery, product requirements documents, reporting), which Ashu wants visible and adaptable for the platform as a whole. That is a separate request.
