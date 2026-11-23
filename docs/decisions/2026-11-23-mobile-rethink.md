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
