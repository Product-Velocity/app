---
date: 2026-11-10
by: Ashu (apply stays a plain admin action, the vote informs and leadership decides); the rest decided by Claude, for Ashu to review
request: 397
---
**The vote informs and leadership decides: an admin can change the order before applying it and must say why wherever it differs from the vote.** Ashu (2026-11-10): the crowd's ranking is not automatically final and not imported by itself; **apply stays a plain admin action for now** (no decision gate, no Approver requirement). The points below were open in issue #397; any can be reversed.

1. **What "differs from the vote" means.** For the initiatives the admin includes, the vote suggests a rank for each (best place first, ties in their current order, onto the positions they already hold: the rule of #394). A reason is needed for every initiative whose final rank is not that rank, **including one that stays where it is while the vote would move it** (keeping something in place against the vote is a decision too). One that matches the vote needs none, and a reason typed for it is ignored.
2. **The database decides, not the browser.** `alignment_rank_apply()` works out the vote's rank itself from `results_snapshot` and refuses an order with a missing or over-long reason (`PV026`). The server and the page work it out with the same pure functions (`@pv/domain`, tested against each other through the database tests), so the review step shows exactly what the database will check.
3. **Reasons are admins only.** A reason can hold commercial context ("a customer threatened to leave"), so it lives in its own table with admin-only RLS rather than in `alignment_rank_applications.moves`, which members can read. Members get no row from `item_alignment_decisions()` either. They are in the audit log, which only admins read. Resolves the open question in the issue.
4. **Never in a tracker payload (rule 2).** Nothing in the GitHub, Jira or Atlassian code reads these tables or functions; a test scans those directories and fails if that changes.
5. **Reasons are free text from an admin** and are treated as data, never as instructions (rule 4): they are shown as text and never passed to Claude as a prompt.
6. **Length:** 1 to 300 characters after trimming and collapsing spaces, checked in the page, the server and the database.
7. **Undo** restores the order exactly as in #394 and keeps the reasons with the undone application; the item panel stops showing a reason once its application is undone.
8. **Applying an order that changes nothing** (including keeping today's order against the vote) is refused with "nothing to apply", after the reasons are checked.
9. **Not built here:** drag and drop (Up, Down and a typed place cover the keyboard and pointer; drag can be added), a gate or Approver requirement for apply, and per-cycle rank (#121).
10. **Migration** `20261110112748_alignment_rank_reasons.sql` replaces `alignment_rank_apply(uuid, jsonb, text)` from the merged #398 (same signature) and adds a unique `(tenant_id, id)` key on `alignment_rank_applications` for the new foreign key. No other open branch changes that function.
