---
issue: 735
status: done
logged: 2026-11-27
done: 2026-11-27
link: PR #736 and the build start PR
title: Tracker Status of an initiative synced to a Jira Initiative reads like one with listed epics; build dates from the epics
---
From Ashu after syncing R-102 to RR-7 (2026-11-27): whether an initiative only lists epics or is also synced to a Jira Initiative, the core is the same: follow the build status of the epics, show they are linked and counted, measure progress, register the build start and end.

**Built:** Tracker Status of an initiative linked above Epic is the epics roll-up ("6 of 7 epics done"), never the Initiative's own status and never "Not linked". Build Status was already driven by the epics (checked in production: R-102 is level 2, its own status is never applied). **Also built (Ashu, 2026-11-27):** Build started uses the tracker's Start Building first and Product Velocity's move to Build as the fallback (`docs/decisions/2026-11-27-build-start-tracker-first.md`), and the Jira and GitHub tab dates follow the person's date format.
