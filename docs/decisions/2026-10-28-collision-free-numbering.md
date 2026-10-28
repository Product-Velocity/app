---
date: 2026-10-28
by: Ashu
request: 238
---
**Shared sequential counters are no longer allocated by hand.** Migrations are named by UTC timestamp (the numbered set 0001 to 0058 is frozen); a feature PR adds a release fragment instead of bumping the version, and the version is assigned when it is merged; requests are numbered by their GitHub issue and kept one file each, and so are decisions. Reason: parallel agents kept picking the same request id, version and migration number (R-112, R-114, 0.47.0, 0.50.0, 0053, 0054 and 0057 were each used twice) and conflicted in the shared tables on every merge. See `docs/23-PARALLEL-WORK.md`.
