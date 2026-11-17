---
issue: 480
status: done
done: 2026-11-17
logged: 2026-11-17
title: Build fields are live; build time from the tracker dates; Jira/GitHub status column
---
"I now understand that Build Status is a PV internal status that is static across Jira/GH. Great. However, do we also have the platform specific status in our grid column selection? For the delivery grid view I would prefer to be able to split on the actual Jira/GH build status (versus the PV one). Also, with regards to build dates and statuses, some say phase 3 and 4, but I believe we have many or most of them already. We should use them, also in the reports on build time/weeks. Can we make all those updates." Two pull requests: (1) the live fields, build time from the tracker dates and a Build time report; (2) the platform status field. See docs/decisions/2026-11-17-build-fields-live.md.

Part 2 (this PR): Tracker Status, Flags and Actions columns and Jira colours; see docs/decisions/2026-11-17-tracker-status-flags-columns.md.
