---
date: 2026-11-27
by: Ashu (chat, 2026-11-27), written by Claude
request: 735
status: built, to confirm
---
**Build started comes from the tracker first; Product Velocity's move to Build is the fallback.**

- **Why.** R-102 showed "Build completed 17 Nov (started 24 Nov)". The completed date came from the epics, the start from the day the initiative was moved to Build in Product Velocity (the audit log), which was later. The Jira sync already writes the epics' real start into Start Building (replacing a typed date), and the move to Build only fills Start Building when it is empty, so the Building Time numbers were already tracker-first. Only `item_build_cycle()` (the Build started / Build completed dates on the Jira and GitHub tabs and the build days there) still preferred the audit date.
- **Now.** Started = Start Building when it has a date, else the first move to Build. Completed is unchanged (the ticket closed as completed, the Jira issue resolved while done, else the latest epic resolution once every epic is done). Migration `build_start_tracker_first` (one function, same columns, same permission check, no data touched).
- **Not changed.** Phase moves, gates, Start Test / Experiment / Roll-Out (Product Velocity sets them), and what is sent to Jira.
