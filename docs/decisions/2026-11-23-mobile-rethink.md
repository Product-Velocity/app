---
date: 2026-11-23
by: Ashu
request: 635
---
**The phone is a product of its own: it never sends people to "the website".** Ashu (2026-11-23): the phone version talked about the website and the option to go there, which is not good; it needs dedicated mobile-first features.

- **Bottom bar:** Initiatives, Decide, ＋ Add, Tracker, Insights. For you, Needs attention, Alignment, Reports, Account and Help are under More and in the screens that need them. Alignment results sit under Decide (a link on the Decisions screen). Insights opens Leadership and Reports until the dedicated chart screens exist.
- **Initiatives** opens on the 15 most recently changed initiatives, each saying what changed and when; search looks through every initiative. **Tracker** shows the latest 10 changes that came from GitHub and Jira, with a search for a tracker item.
- **"Changed" means meaningful changes only** (default chosen by Claude, to be confirmed by Ashu): phase, status, health, and for the tracker feed Build Status and the linked issue's status. Rank, owner, G2M date, gate and documents arrive when the member-readable change feed (`change_feed`) is extended in a later slice.
- **Wording:** no "Open on a computer" screens. The grid and the Gantt send a phone to the Initiatives list; the greyed-out desktop entries are gone from More.
- **Push notifications stay off** (decision 2026-11-09); Ashu may reopen it for three events: gate requested, decision made, mention.
- **Data:** both feeds read `change_feed` (member readable, no migration, no new table) and the tracker links, for GitHub and Jira alike (tracker parity). Team and initiative level only (rule 8); commercial fields are not in the feed (rule 2).
- **Insights (P2):** `/insights`, active initiatives only: key numbers, health, where the work is, build progress by project, planned quarters; each chart has a sentence and a table. Never per person.
- **Since you last looked (P2):** the moment of the last look is kept per device in the browser, with no new table; Ashu can ask for it to follow the person across devices later (a small table, with RLS tests). Own changes are left out.
- **Decide with alignment (P3):** the Decide tab has Gates and Alignment results. It shows what the database lets the person read (members: closed sessions that allow results; admins: all but drafts), as aggregates only (rule 7).
- **Follow (P4b):** kept in the person's own profile (user metadata, per workspace, at most 100), not in a table: it is a preference, not workspace data, and it follows the person across devices. It only changes what is shown first; nobody is told. Following does not send notifications (push is still off).
- **Quick changes with a note (P4b):** Health and Initiative Status only (Initiative Phase goes through a gate; tracker fields are read only, rule 6). A concern needs a reason of 4 to 300 characters; others may have one (Claude's default, to be confirmed by Ashu). The reason is kept on the audit row (`audit_log.basis`) with the actor and the source, and every member can read it next to the change: it is context for the change, never a commercial field. The change goes through the same role checks as any edit (SECURITY INVOKER). One migration, no new table. "Put it back" is a second change with its own history.
