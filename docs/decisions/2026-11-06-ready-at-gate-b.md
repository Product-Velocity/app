---
date: 2026-11-06
by: Ashu (instruction 2026-11-06), written by Claude
request: 358
status: built
---
Date: 2026-11-06. Issue #358. Decided by Ashu: when Product Velocity sets an initiative to Ready for build (Gate B, Go or Go with conditions), update the tracker so engineers can see what is ready: **Jira -> status "To do"**, **GitHub -> Project board Status "Ready"**. From there the tracker moves it on until done; PV reads Build Status back (Done) and Needs attention suggests Test. Reason: less manual work finding what is ready for development (GitHub issues #354-356 sat in "Backlog" after Gate B).

**Why this is a rule change.** `docs/04` said the board Status "is GitHub's ... never written", and `docs/16` said no status is written to Jira except closing removed initiatives. This adds a **second, narrow exception for both trackers** (same flow, same wording; CLAUDE.md rule 6 otherwise stands: Build Status stays tracker-driven and read-only, a closed ticket never completes the initiative, Initiative Status is set by people only).

**The rules**
- Written only through the existing confirmed Sync: the "To send" preview shows "Ready for build: Set Status to Ready" (GitHub) or "Move to To do" (Jira) per initiative. No commercial field is read or written; the only things sent are the board option "Ready" and a Jira transition id.
- Only for an initiative that is Ready for build (`ready_for_build_at` set and phase Build) and whose link is mode `push`. A followed or adopted-read-only link is never touched. Hold or Stop at Gate B leave `ready_for_build_at` empty, so nothing is written.
- **Forward from the start only.** GitHub: only when the board Status is empty or "Backlog". Jira: only when the status category is To Do (`new`) and the status is not already named To do. Anything further along (In progress, Done, Ready already) is never moved back and never cleared. The state is read again immediately before the write, so a status that moved after the preview is not overwritten.
- **GitHub:** the single-select option named Ready on the board's mapped Status field. PV creates no field and no option; a board without Ready gets the preview note "add Ready in GitHub" and nothing is written. Needs the Projects write permission already required for boards; the connection check line "GitHub Project boards" now says so.
- **Jira:** the workflow transition into a status in the To Do category (the status name means nothing, the category does; when several, the one named "To do"). If the workflow allows none, the preview says so and nothing is written.
- **Once.** `item_github_links` and `item_jira_links` remember (`ready_handled_at`, `ready_result` set or already_ahead, `ready_status`; functions `github_record_ready` and `jira_record_ready`, service role only, creator or admin who is a person, never MCP, only push links, only a Ready for build initiative). Reading the board Status back (webhook, daily check) therefore never makes PV write again, and a person who moves the item back to Backlog is not overruled. Audited as the person, source UI.
- Claude can never decide or move a gate; the phase guard (PV004, PV006) is untouched. Claude has no tool that reaches this code.
- Guarded by tests: the only Jira transition builders are `jira-close.ts` and `jira-ready.ts` (`transition-guard.test.ts`); the only board Status writer is `ready.ts` (`close-guard.test.ts`).

Parity: built for both GitHub and Jira, same flow and wording. GitLab later behind the same step.
