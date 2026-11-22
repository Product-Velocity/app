---
date: 2026-11-22
by: Ashu
request: 592
---
**The PM role can see who voted what** (changes rule 7 in `CLAUDE.md` and `docs/19-ALIGNMENT-PRIVACY.md`, new Q7).

- **Which role.** The app has no role called PM. Roles are Viewer, Commenter, Creator, Admin (and Leadership). The people who run product work are Creators, so "PM role" means **Creator**. To narrow it later (for example to the person who created the session), only the function `alignment_reveal_names` and one policy change.
- **What a Creator gets.** The same logged "Show names" action admins have: a reason of 5 to 300 characters, an audit entry written before any name is returned, never for Claude or a service account (`PV004`), people in the order they joined and never ranked (rule 8).
- **Limits, enforced by the database.** (1) Only once the session is **closed or archived**; admins can still open names while it is open (Q2). (2) Only if **every participant who joined agreed to the new wording** (consent version `2026-11-v2`, "Workspace admins and product managers (people with the Creator role) can see who gave which answers"). People who joined under the earlier wording were told only admins can see; for those sessions Creators are refused and admins can still open names.
- **Reading closed sessions.** Creators now read every closed or archived session, also with results off, so they can reach the page. Commenters and viewers are unchanged.
- **Unchanged.** Participants stay anonymous to each other; groups under 5 are hidden in results; the participant list (emails, delivery state) stays admin-only; Claude sees none of it.
- **Platform staff.** Names now check signed-in human admins, so a staff entry into a workspace no longer opens names (docs/19 Q4 already said staff never see ballots).
- **Wording changed** in the participant consent lines, the privacy page, the Help page "Alignment", `CLAUDE.md` rule 7 and `docs/19`.
