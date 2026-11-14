---
date: 2026-11-14
by: Ashu
request: 437
---
**Group by gets a categorised picker, two levels and an option to show tracker issues under each initiative; the Filter and Columns buttons say their state like Group by does.** Ashu asked for it on 2026-11-14. Decisions taken while building it (Claude, within that request):
- **Two levels are our own, not AG Grid's.** Row grouping is Enterprise only (spike S1); grouping here already was header rows built in `buildGroupedRows`, so a second level is the same function applied inside each group. No new AG Grid feature.
- **Storage.** `saved_views.group_by` stays the first level; `then_by` (text, empty by default) is the second and `show_issues` (boolean, false by default) was added for a separate issue option. Two new columns rather than turning `group_by` into a list: older views, the cards view, the MCP reader and the audit log keep working unchanged. Migration `20261114224144_group_then_by_and_show_issues.sql`.
- **At most two levels.** More would give many tiny groups; raising the cap later is one line in `sanitizeView`.
- **Issue rows are read only.** They show the first level of the linked Jira or GitHub issues (the same as the Excel report with epics), not the full tree, and never in customer-safe views. They are not selectable or editable; Initiative Status and Build Status rules are untouched.
- **A pick closes the panel** (as before). Reopened, the panel is on the empty "Then by".
- **Labels:** "Filter: None / Filter: 1 active", "Columns: 14 of 168 shown" (168 is the fields the app shows: the dictionary has 169 and Roadmap Category is hidden).

**Update, same day (Ashu tested 1.144.0):** the separate "Show issues" checkbox is replaced by a grouping choice, **"Initiative, with its issues"**, that can be the Group by or the Then by level. In a flat list the issue rows did not read as nested under their initiative; as a grouping level, each initiative is a header and its issues sit under it. The stored value is the pseudo field `initiative_issues` in `group_by` / `then_by`. Nothing can follow it as the main level. In that view the initiative's own data row is replaced by its header (editing columns needs another grouping). `saved_views.show_issues` is left in place, unused (forward-only; a later migration can drop it); nothing reads or writes it.
