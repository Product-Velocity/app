---
date: 2026-11-10
by: Claude (for Ashu to review)
request: 394
---
**A person applies the vote to the Stack Rank as a reorder of the positions the voted initiatives already hold, in one audited step that can be undone while nothing has moved since.** Issue #394 (the second half of #127). Rule 3 stands: Claude never sets Stack Rank. The points below were open in the issue; any can be reversed.

1. **How the vote merges with initiatives that were not voted on (the design choice the issue named).** The voted initiatives swap among the Stack Rank positions they already hold; everything else keeps its place. The best place in the vote gets the best of those positions. This never opens a gap, never makes a duplicate and never moves an initiative outside the vote. The database checks the same rule (the ranks before and after are the same set, each once).
2. **Ties** keep their current order relative to each other, and the page says so.
3. **Selection.** An admin can tick a subset; the ticked initiatives then reorder among their own positions (recomputed, so the preview always matches what is applied).
4. **Who.** Admins only, although creators may re-rank one initiative by hand (`move_item`). A vote touches many initiatives at once and the results page is admin-only anyway. Loosen later by changing the check in `alignment_rank_apply()` and the page.
5. **Stale and repeat.** The browser sends the ranks the person saw; if any differs from today's rank the server and then the database refuse (`PV025`) and the page asks again. Applying twice is refused the same way, because the second preview no longer matches.
6. **Audit and undo.** Per-initiative audit rows come from the existing trigger (actor, source, old and new `stack_rank` and `previous_rank`) plus one entry on the session (`rank_applied`, `rank_apply_undone`) and a row in `alignment_rank_applications`. Undo restores both columns exactly, once, and only if every initiative is still where the application put it (`PV025` otherwise). **Deviation from the issue:** undo is a button on the results page, not ⌘Z in the grid. The apply happens on another page, so the grid's own undo stack does not know about it. The audit log and the button give the same exact restore.
7. **Fit line.** Not shown; capacity planning (#119) is not built. The page says so instead of leaving it out silently.
8. **Previous Rank** is set to the old rank, as `move_item` does.
9. **Scope.** Only the default (global) Stack Rank. Initiatives in a planning cycle, or in the Trash, are left out and counted on the page (cycles arrive with #121).
