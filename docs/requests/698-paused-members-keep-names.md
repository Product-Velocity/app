---
issue: 698
status: in progress
logged: 2026-11-26
title: Paused, revoked and requested members keep their name on initiatives and in reports
---
Ashu: "yes, fix the paused members too" (answering: paused and revoked members show as "unknown person" on initiatives because the people directory only listed active members). Follow-up to #691. `people_directory()` now returns every person with a status; the app resolves names from all and offers only people who can be chosen.
