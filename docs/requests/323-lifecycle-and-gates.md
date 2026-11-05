---
issue: 323
status: in progress
logged: 2026-11-05
title: Lifecycle and decision gates: phases, Gate A/B/C, Decisions screen, sync start and freeze
---
Ashu (2026-11-05): finalize the lifecycle steps, the decision gates and how to signal, decide and complete a move; when to start syncing items to GitHub/Jira (engineering feedback); when to stop syncing finished items to save calls. Decided in `docs/decisions/2026-11-05-lifecycle-and-gates.md`. Slices are listed in the issue. Docs still saying G1 to G4, Beta-test, Sunset or Spec Status are corrected in slice 1.

Built in one sprint (2026-11-05), slices 1 to 6 in order: names and docs; gate tables and functions with RLS tests; the Decisions screen, bulk bar, item panel and read-only phase cell; Discover never synced and the pv:define label (GitHub and Jira); freeze and resume with the daily job; the read-only `get_gate_pack` tool. What is not built is listed in `docs/28-DECISION-GATES.md` section 11 (notifications, Stop closing the tracker issue, a Needs attention screen, gate reports, a dedicated review button, server-side limit of what the grid loads). Stays `in progress` until those follow-ups have their own requests.
