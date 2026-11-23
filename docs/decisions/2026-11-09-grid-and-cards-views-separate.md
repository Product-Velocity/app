---
date: 2026-11-09
by: Ashu (instruction 2026-11-09), written by Claude
request: 390
status: built
---
**The Grid and the Cards screen each have their own saved views, customised default views and view bar.**

**Why.** Issue #371 put the view bar on Cards but kept one set of rows, so customising "Delivery" on Cards overwrote the Grid's Delivery (13 columns became 4). The two screens show different things (a grid needs many columns, a card shows five fields), so they cannot share a definition.

**The rules**
- `saved_views.surface` and `view_layouts.surface` (`grid` | `cards`, default `grid`, fixed once written). Every row that existed is a Grid row; Cards starts with its four built-in views and nothing saved.
- Everything that was unique is unique per screen: view names, the one customised built-in per name, the bar of a person or the workspace. A Grid view and a Cards view may share a name.
- Caps (25 private views per person, 14 added workspace views) count per screen. A bar row can only point at a view of its own screen (the database refuses it).
- Visibility and permissions are unchanged (workspace views: admins write, everyone reads; private views: owner only).
- Claude's `views` tool lists Grid views only (no tool change, so no Help change).
- Nothing is copied between screens. Duplicate a view on the screen you want it on.
- Data repair: the Grid Delivery view's columns were restored to their value before the Cards edit, read from the audit log.
