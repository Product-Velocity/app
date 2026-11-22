---
date: 2026-11-22
by: Ashu
request: 591
---
**Needs attention and Decisions are lists on the shared grid (`grid-kit`), with the same toolbar, and snoozing hides a reason for the whole workspace.** Shared parts live in `apps/web/src/features/lists/list-kit.tsx`: search (`/`), filter pop-ups with counts, column picker, saved views, CSV download. Row models are pure and tested (`attention-grid.ts`, `decision-grid.ts` in `packages/domain`).

Choices made without asking, change them if you disagree:
- **Saved views, chosen columns and widths are kept in the browser** (like the Changes report), not on the server; server-side views are a later request.
- **Snooze is a view filter only** (table `attention_snoozes`, one row per initiative and reason, until a date or dismissed, audited, Creators and above change it, everyone reads it). It never changes a phase, a gate or an item value (rules 3 and 6). A snoozed reason that comes back later is the same reason, so it stays hidden until the date; a different reason still shows. Undo is Ctrl+Z.
- **Bulk steps use the same functions as the single ones**: Move to Test (`move_phase`) and Request gate per selected group; each row's result is reported. Bulk decide reuses the existing Decide dialog, which still needs a rationale; an incomplete checklist is shown as a warning, never a block (docs/28 section 3).
- **The checklist column is worked out now when none was recorded with the request**, and says so in its tooltip.
- **No column, filter or sort ranks the people who decide or the people who work** (rule 8). The Product Manager column names who owns an initiative.
- A request with no recorded requester shows "Not recorded", not "unknown".
