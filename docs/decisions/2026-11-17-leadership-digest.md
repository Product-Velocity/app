---
date: 2026-11-17
by: Ashu, Claude
request: 482
---
**The leadership section "What moved this week" is a digest of net outcomes, and the weekly update can be pasted into an email with working links.** Ashu (2026-11-17): the section listed only Build Status changes and read like a log; leadership needs how things are moving, with phase moves, health, the Jira build status next to Product Velocity's, and new documents, not every status change. Ashu's answers: do not group as "delivered" but name the actual phase move ("x moved from X to Y"), with Completed last and on its own; template text, no AI narrative; everything referenced (a Jira ticket, a new document) must be clickable; the text must be copy-and-paste ready for an email.

- **Net outcome.** First old value to last new value per initiative and per dimension (phase, health, linked-issue status, Build Status); nothing when it ended where it started. Rank already worked this way.
- **Groups and order.** Completed, Phase moves (furthest phase first), Health (worse first), Priority, Build and tracker status, New documents and files, Needs a decision or action. At most six lines each, then a link to the Changes report.
- **Jira versus Product Velocity.** The line says what the tracker says ("Jira R8P-7049 moved from To Do to Done") and, separately, "Build Status in Product Velocity: Not started to Done". A tracker that says done while the phase has not moved shows in the last group as the existing flag ("Tracker done, initiative open", suggested Move to Test).
- **Links.** Initiatives (`/portfolio?item=CODE`), the Jira or GitHub ticket (its own address from the link), documents (`...&tab=spec&doc=ID`; files and links open the Spec tab). Absolute addresses, so they work in an email. They need a workspace login: **no public page is created**, so no document text leaves the app (rules 2 and 4). A document title can itself be commercial text; the update is edited and reviewed by a person before it is copied.
- **Email copy.** The text stays plain text with a tiny Markdown (`[name](address)`, `**bold**`, `- `). **Copy for email** writes HTML and plain text to the clipboard (inline styles, escaped, http and https only); **Copy plain text** writes "name (address)".
- **No new table and no migration.** Documents are read through the member's own access, by column (never `body`). A test pins that the digest never carries a person.
- **Choices made without asking:** the period is the ISO week (a month view can reuse the same function); only the Changes report's flags are used for follow-ups, not the gate-based reasons; gate decisions are not listed (they are on the Decisions page); document titles of AI drafts say "AI draft, not yet reviewed".
- **Parity:** built for GitHub and Jira (same data path). **Not verified:** pasting into a real Gmail or Outlook compose window (the HTML is the common subset those clients keep); check once.
