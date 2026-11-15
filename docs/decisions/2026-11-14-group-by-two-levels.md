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
- **The panel is staged, like Columns** (Ashu, 2026-11-15): Clear, Cancel and Apply at the bottom, the panel stays open until Apply or Cancel, nothing changes in the grid before Apply, and both levels and the issues option are set in one visit. (First built as pick-and-close.)
- **Labels:** "Filter: None / Filter: 1 active", "Columns: 14 of 168 shown" (168 is the fields the app shows: the dictionary has 169 and Roadmap Category is hidden).

**Update (Ashu tested 1.144.0, 2026-11-14 / 2026-11-15):** in a flat list the issue rows did not read as nested under their initiative. A grouping choice "Initiative, with its issues" was tried (initiative as a header, its data row replaced) and then dropped. **Final:** the separate "Show issues" checkbox is back in the Group by panel; when on, each initiative keeps its data row and gets a **third-level "Issues of R-01" header** (count and issue status in words, collapse / expand per initiative) with its issues beneath it. It sits under whatever grouping is on. The stored value is `saved_views.show_issues` again; no migration.
