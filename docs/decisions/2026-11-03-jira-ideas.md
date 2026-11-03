---
date: 2026-11-03
by: Claude (within issue #257; spike J8, write half; nothing could be run, Jira is not reachable from the cloud session)
request: 257
---
**Jira Product Discovery ideas stay read-only until Ashu has run the two J8 probes.** The mapping "PV initiative = the idea" in `docs/16` keeps its "read-only" wording and now says "write unverified".

**Why no write yet.** Whether ideas can be created, edited and linked with our scopes (`read:jira-work`, `write:jira-work`) is a fact about a real site, and nothing here may be built on a guess: Product Discovery fields (Impact, Effort, Theme, Idea short description, Roadmap) have site-specific ids, may be missing from the screen of the Idea type, and some (Roadmap, ratings) may only be settable inside Product Discovery. Writing them blind would show up as silent skips in Sync.

**What was built (spike only, no product behaviour).** `probeIdeaWrite` (mode `idea`): finds the five fields by name in `/field`, reads `editmeta`, sets each field in its own request (shape chosen from the schema and allowed values; plain string then ADF for text fields), sets an ADF description (heading, bold, bullet list), reads back and compares, and deletes the idea. `probeIdeaLink` (mode `idea-link`, second explicit click): creates one idea and one Epic in a software project, tries every issue link type between them (each link removed at once), tries `parent` of the epic = idea, deletes both. Both refuse a project of the wrong type. Output is status codes, field ids and kinds, link type names and node types, never issue text, site address, account id or email. Tested with a fake Jira.

**How the result decides the build.**
- All five fields writable, ADF round-trips, one link type works → ideas become two-way like Epics: through the existing allowlist, field map and Sync preview (Impact/Effort stay out of the allowlist: they are commercial-adjacent, review before mapping), the link type from the probe is the "delivers" relation, and children stay read-only. New decision then.
- Some fields refused → write only the summary, description and Theme text (as for epics), show the refused ones as read-only in the field catalog.
- Create/edit refused or no link type accepted → ideas stay read-only; the delivery epic is read by its link from the idea and the PV initiative is the epic (standard Jira mapping) with the idea shown as the origin.
- `parent` expected to be refused (an idea is level 0); if it is accepted, report it before using it.

**Unverified:** everything above about real Jira behaviour.
