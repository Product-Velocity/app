---
bump: patch
type: fixed
---
**Fix: Build started follows the tracker.** An initiative whose epics finished before it was moved to Build in Product Velocity showed a build that started after it ended. Build started now uses the Start Building date that comes from Jira (the earliest epic or task that moved to in progress), and falls back to the day the initiative moved to Build in Product Velocity only when there is none (migration `build_start_tracker_first`).
