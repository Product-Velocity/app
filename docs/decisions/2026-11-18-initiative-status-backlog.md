---
date: 2026-11-18
by: Ashu (Refinery89 roadmap import review, 2026-11-18), written by Claude
request: 504
status: built, to confirm
supersedes: "Initiative Status shrinks to Active, On hold, Cancelled" in 2026-10-28-status-alignment.md, for the Backlog value only
---
**Initiative Status becomes Backlog · Active · On hold · Completed · Cancelled.** Backlog means the initiative has not started and is parked. On hold means it was running and was paused for a reason. Ashu found no value for "not started and parked": Planning Status Backlog belongs to planning cycles (capacity), which many tenants will not run, and On hold implies it was active.

- **Planning Status keeps its values** (Backlog, Not started, Candidate, Included, Committed, Deferred, Dropped). It is for planning cycles only; nothing is removed or converted.
- **No automatic change.** Backlog is set by a person. Starting work means setting Active. Needs attention, Roadmap Health and the Active quick filter count only Active, so Backlog items are never nudged as stalled and are not counted as active work.
- **Completed follows Initiative Status** as before; Backlog never changes the phase.
- **R98 mapping:** R98 Initiative Status Backlog (16 initiatives) becomes Initiative Status Backlog, with Planning Status empty and Health empty.
- **Migration** `20261118141101_backlog_initiative_status.sql`: the check constraint only. Never synced to GitHub or Jira.
