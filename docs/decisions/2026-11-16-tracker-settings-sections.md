---
date: 2026-11-16
by: Claude (for Ashu to review)
request: GitHub and Jira settings pages hard to read and work with (Ashu, 2026-11-16); no issue number yet
supersedes: the two-section split of 2026-11-03-tracker-field-config.md and the separate field list / editor of 2026-11-11-tracker-field-table.md
---
**GitHub and Jira settings are now five sections, in setup order, full width, with one field table (same on both trackers, `2026-11-03-tracker-parity.md`).** No database change: nothing about what Sync sends changes.

1. **Five sections, one route each** (`components/tracker-tabs.tsx`, `lib/tracker-fields/sections.ts`): **Connection** (`/settings/integrations/<tracker>`), **Projects** (`/projects`), **Field mapping** (`/mapping`), **Inbox** (`/inbox`), **Sync & logs** (`/logs`). Each route loads only what it shows. Until a connection works only Connection is a link; the others are marked "connect first". Actions return to the section they were used on (notices included).
2. **Status header on every section:** name, a state word with colour, where it is connected, the counts that matter as links (projects that use the tracker, default or customised mapping, Jira issues waiting, last check) and, until set-up is complete, a "Next: …" button. Connection also shows a 3-step set-up list (connect, choose projects, check the mapping; the last is optional because the defaults work).
3. **Full width** (`.page-full`) instead of the 960px column, like the grid.
4. **One field table instead of a catalog plus an editor** (`FieldWorkbench`): every Product Velocity field, its direction, the tracker field it goes to and its setting, editable in the row. It opens on **Synced** (what Sync moves). Filters with counts: Synced, Can change, Read only, Not synced, Never synced, tracker fields not linked (the connection's own fields nothing uses), All; plus search and "Show more". Editable rows stay in the page whatever the filter says, so one Save sends them all. A sticky bar shows "Unsaved changes" with Save and Reset all. One project at a time (picker), so the page scales with more projects and more fields. Names (stealth mode) are folded in the same form.
5. **Copy to other projects:** writes the saved settings of one project to others with the same tracker (Jira: same site only, field ids differ). Same database functions as a normal save, admin only, nothing written to the tracker. GitHub board fields are not copied.
6. **Long tables:** search, "only projects that use <tracker>" and "Show more" on Projects and Repositories (`TableTools`).
7. **Parity exception (Inbox):** Jira's waiting issues are listed in this section; GitHub's live on Incoming, so GitHub's Inbox section is a short pointer to it. Reason: GitHub's list already exists elsewhere in the app. Moving it here is a later slice.
8. **Not done:** bulk set of repository access (needs a new action; the repositories table has search and paging only). The old `table-query.ts` stays because its tests cover shared link logic; it is no longer used by a page.
