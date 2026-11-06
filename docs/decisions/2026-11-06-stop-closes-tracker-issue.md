---
date: 2026-11-06
by: Ashu, proposed by Claude
request: 343
status: built
---
Date: 2026-11-06. Issue #343. Decided by Ashu: "yes, same confirm flow".

- An initiative stopped at a gate (latest decided decision is Stop, status Cancelled) is offered in "Removed or stopped in Product Velocity", in both trackers, with the same confirm-one-by-one flow as a deleted initiative (decisions 2026-11-03-github-close-removed and jira-close-removed).
- Same safeguards: only issues Product Velocity owns; never automatic; audited; Claude cannot trigger it (MCP is refused for Jira).
- **Label:** the existing `pv:removed` is reused instead of a new `pv:stopped`, to keep one label to strip/exempt on both trackers. Change later if people want to tell them apart.
- Database: `item_is_stopped(uuid)`; `github_record_removed` / `jira_record_removed` accept a Trash item or a stopped one, otherwise 22023.
- Parity: built for both GitHub and Jira.
