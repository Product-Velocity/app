---
date: 2026-11-25
by: Ashu
request: 672
---
**Completing an initiative: where it is, what it does, and what Claude reads.** Ashu could not find how to move an item to Completed (R-142 went Experiment to Completed by setting Initiative Status) and asked what happens to the other status fields.

1. **Move to next phase now offers "Completed (sets Initiative Status)".** It sets Initiative Status to Completed, the phase follows (unchanged rule, `2026-10-29`), and the dialog says what happens. `move_phase` still refuses Completed; nothing is added to the database for this.
2. **Completing before Roll-out skips Gate C and Roll-out. People are told; it is not blocked.** A Creator may close an initiative that never rolled out (internal work, a change of plan), and the audit log records the status and phase change. After the edit the grid shows a notice (Undo puts it back); the Move dialog says it before the click. If Ashu wants it blocked, Cancelled is the other ending and a gate request is the recorded way to roll out: that is a later, separate decision.
3. **Completed clears Health.** The Help page already said blank. The database does it (`items_system_fields`, migration `20261125103356_completed_clears_health`), so the grid, Jira, MCP and imports behave the same. The old Health stays in the audit log. Reopening (status back from Completed) puts the cleared Health back, unless a person set another one meanwhile. Planning Status and Build Status are untouched. Existing Completed items keep their Health until their status next changes (no data backfill).
4. **Claude reads the Flags and Actions columns.** They are worked out, not stored (item-fields N50, N51), and only the browser worked them out, so `search_items` and `get_item` returned them empty. The MCP reader now derives both from the same rules (`rowFlagTexts`, including the outcome-review flags) with the caller's role, so a viewer gets flags and no actions. Actions are the words of the next step; Claude still cannot act on them (rule 3).
