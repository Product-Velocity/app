---
date: 2026-11-28
by: Ashu (the decision); how it is built is Claude's proposal, for Ashu to review
request: 750
---
**The voter consent step can be removed.** Ashu (2026-11-28): a vote runs inside one company, so the company's own policies apply, not Product Velocity's; remove the Product Velocity privacy line and remove the voter's accept step ("b, remove consent step"). Not built yet; it ships with the branded voting screens (issue #750, slice 2). `docs/19` and CLAUDE.md rule 7 are amended in that slice, not before.

**What the consent step carried, and what takes over** (so nothing silently disappears):
1. **No consent, no ballot** (`docs/19` section 7, enforced where a ballot opens). Without the step a participant's consent time is set when they first open the link, with the wording version `none`, so counting, retention and deletion keep working.
2. **Who may see names.** Admins can always open "who voted what" (logged, with a reason). Creators may open it after close only if every participant agreed to the wording that names product managers (`2026-11-v2`). With no consent step that basis is gone, so: **the admin acknowledges at setup, in writing, that the company's own policy covers the vote, including that admins and Creators can see who voted what.** The acknowledgement (who, when, wording version) is stored on the session and audited; Creators may open names only on a session with that acknowledgement.
3. **Telling people.** The company, not Product Velocity, tells its people how their answers are used. The voter screen shows no Product Velocity wording and no consent box; the company can link its own policy in the session's invitation text.
4. **Retention and deletion** are unchanged: personal data of participants is deleted 12 months after the session closes (shortenable), an admin can delete a participant on request, and a participant who asks keeps the same route through the link page.

**How it is switched (my proposal; reverse if you want it removed outright):** a per-session setting **"Ask voters to accept before voting"**, default on. Turning it off needs the admin acknowledgement above and locks when the session opens. I did not remove the step unconditionally because Product Velocity serves many workspaces and some will invite customers or partners, where the platform's own terms and the law may still ask for it; for Ashu's company the setting simply stays off. If you want the step gone for every workspace, say so and it becomes a code removal instead of a setting.

**Not changed:** existing sessions and participants, the recorded consent of earlier sessions, anonymity of results, the under-5 group rule (its own request), the 12-month retention.
