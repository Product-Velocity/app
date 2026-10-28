---
issue: 238
status: in progress
logged: 2026-10-28
title: Parallel agents without collisions on numbers
---
Ashu asked what the best practice is for several agents working on the same code at the same time, preventing version numbering issues and branch conflicts, and approved the proposal ("yes, approved"): timestamp migrations, release fragments with the version assigned at merge, request and decision files named by issue number, plus the working agreements in `CLAUDE.md` and `docs/23-PARALLEL-WORK.md`. Merge queue, required up-to-date branches and the release workflow's permission to push to `main` are repository settings for Ashu (listed in `docs/23`).
