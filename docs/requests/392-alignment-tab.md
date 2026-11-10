---
issue: 392
status: done
logged: 2026-11-10
done: 2026-11-10
link: PR #404 (v0.134.0)
title: Alignment tab in the header: session list, what needs you, start a session
---
Ashu (2026-11-10): move Alignment from the account menu to the tab line (recommended), designed like the other tabs: a grid of all sessions from the past with key data (created, closed, quarter, and so on), search and filters on top, a New session button, and stats such as people invited, voted and initiatives ranked. Decided: the quarter column is the **planned quarter** (first said the closing date, changed the same day); the New session picker filters by planned quarter, MoSCoW (Must) and the stages Discover, PRD and Ready for build; members who are not admins see only sessions with results; drafts are admins only. The migration `20261110115820_alignment_list_access.sql` was applied to the Provelo project at Ashu's request ("apply and register migrations") and registered in `pv_meta.schema_migrations`.
