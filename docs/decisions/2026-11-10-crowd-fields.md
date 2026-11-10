---
date: 2026-11-10
by: Claude (for Ashu to review)
request: 393
---
**An initiative's alignment result is the one from its most recently closed session, read from the stored snapshot, and shown to admins always and to other members only when the session lets participants see results.** Issue #393 (the first half of #127). I decided the points below because the issue left them open; any of them can be reversed.

1. **Current result and history.** The current result is the latest closed session (by close time) that included the initiative; earlier sessions stay as history in the item panel. Re-running a session therefore keeps both.
2. **The four Crowd fields (A1 to A4 of the dictionary, no new keys).** Crowd Rank = place in that vote (ties share a place, written `=2` in the panel; the grid column shows the number only). Crowd Score = score, top = 100. Votes = people who voted in the session, a total, never per group. **Consensus = 100 minus the gap between the group rating the initiative highest and the one rating it lowest**, using only the groups the snapshot shows (5 or more voters); empty when it shows none, so a small group cannot be worked out from it. The dictionary left the formula open.
3. **Who sees it.** Admins always; other members only when `show_results` is on for that session (the same switch that lets participants see results, docs/19 section 2). An empty Alignment tab therefore does not prove that nobody voted; the tab says so.
4. **Read from the snapshot, never recomputed.** `item_alignment_results()` (new, security definer, one tenant per call) reads `results_snapshot`, so a later deletion of personal data cannot change what the tab shows. It returns no name, address, ballot or small group.
5. **Live ahead of phase.** The four fields are added to `SHIPPED_EARLY` in the registry (like the gate fields), so the grid drops "Arrives in phase 5" and the Prioritisation default view now shows Crowd Rank as `default-views.csv` always said.
6. **No link to the results page from the panel.** The panel does not know the person's role and the results page is admin-only; a link that gives non-admins a 404 is worse than none. Add it when the panel carries the role.

**Not done, flagged.** Members can read `alignment_sessions.results_snapshot` directly through the API (a table grant from migration 0032), which does not check `show_results`. The snapshot holds aggregates only, but docs/19 says members see results only if allowed. Closing that needs a column-level revoke and a change to the sessions list; it is its own issue.
