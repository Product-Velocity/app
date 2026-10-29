---
issue: 253
status: open
logged: 2026-10-29
title: Jira plan, new items inside the sync dialog, Adopt, Writing x/y counter, Confluence publish
---
Ashu asked to discuss the Jira mapping and the exact features per phase. Decided in chat (2026-10-28/29), written into `docs/16-ATLASSIAN.md` and `docs/06-BUILD-PLAN.md`:

1. Jira follows the GitHub sync model (preview, conflicts, confirm). Initiative level is a per-customer mapping: Epic, a level above Epic, or a Jira Product Discovery idea. Custom fields are discovered at first connection into a field catalog.
2. "What comes in" is part of **Sync with GitHub / Jira**. Step 1 reads the tracker and shows new items; per item you choose Pull in or Ignore, and **Read only** or **PV takes ownership** (Adopt). Step 2 writes (preview, confirm, Writing x/y). Status fields stay read-only.
3. The sync dialog shows **Writing x/y** next to the reading counter, for GitHub as well as Jira.
4. Confluence: publish a PRD or discovery document from PV to a page, as a deliberate previewed act; exception to rule 2 for the customer's own private site.
5. Sign in with Atlassian (R-031) stays later.

Implementation issues per phase (J0 to J8) follow once Ashu confirms the order.
