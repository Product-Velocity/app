---
date: 2026-11-09
by: Ashu (instruction 2026-11-09), written by Claude
request: 364
status: built
---
**The Incoming list gets a Re-pull button for initiatives that are already pulled in; it fills fields that are still empty and never replaces a value.**

**Why.** Ashu pulled in issues before Description, Change Type and Focus Area were kept, so R-01 to R-04 stayed empty, and asked for a button to "re-pull" them "to update the items already in PV with the updated fields".

**What it does.** On the **Pulled in** tab, tick initiatives and press **Re-pull** (creators and admins). For each one the issue is read again; the Description is filled from the body only if it is empty, Change Type from exactly one `type:` label and Focus Area from exactly one `area:` label only if those are empty (same rules as pull-in: `labelFields`, `github_copy_issue_description`, `github_copy_issue_labels`; labels live from GitHub when it reports them, else from the Incoming record). Nothing is written to GitHub. Audited as the person.

**Decided by Claude, to confirm.** "Update with the updated fields" was read as "fill what the new fields would have filled", not "overwrite with whatever GitHub says now": that would replace text people wrote in Product Velocity and would collide with Sync with GitHub's three-way comparison and its Keep Product Velocity / Keep GitHub choices. So no value is ever replaced, which is also why there is no undo step. If Ashu wants GitHub's later edits to overwrite, that is a separate decision (and for an initiative Product Velocity owns it belongs in Sync).

**Parity.** Built for Jira too (issue #365): the Jira Incoming source implements `refreshPulled`, so the same button and message appear on its Pulled in tab. The button is shown only where the data layer supports it.
