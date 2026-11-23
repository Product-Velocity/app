---
date: 2026-11-23
by: Ashu ("Finish #390 for all three screens", and "1 to 7" for the panel), built by Claude
request: 625
status: built, to confirm
---
**Grid, Cards and Gantt each have their own saved views, customised default views and view bar, and the views panel is clearer.** Finishes issue #390 (started 2026-11-09, `docs/decisions/2026-11-09-grid-and-cards-views-separate.md`). One migration, `20261123170000_gantt_surface.sql`.

- **Where this started.** Production already had the `surface` schema of #390 (`20261109225431_view_surfaces.sql`, applied 2026-11-09) but the code and the migration file never reached `main`, so the app still shared views and bars across screens. The migration file is now in the repo, byte for byte (its sha256 matches what production recorded), and the app uses `surface`.
- **`surface` is now `grid`, `cards` or `gantt`** on `saved_views` and `view_layouts` (the new migration widens the two check constraints and the screen check in `replace_view_layout`). Names, the one customised built-in per name, the caps and the bar are per screen; a bar row can only point at a view of its own screen (all from #390). Nothing is copied: every existing view and bar stays the Grid's; **Cards and Gantt start with their built-in views and nothing saved**, so views people saved while the screens shared them now show on the Grid only (Duplicate and save again on the other screen).
- **An admin's "Update for everyone" on a default view changes that screen's default only** (it used to change the same name on every screen).
- **Claude's `views` tool lists Grid views only**, as decided on 2026-11-09 (no tool change, so no Help page change for Claude).
- **The views panel** (shared by the three screens): a My bar / Workspace bar switch for admins with a banner in workspace mode; the open view and its Save, Update and Reset buttons stay at the top with a one-line summary of what changed; "In your bar" (3 of 6) is a list you drag to reorder, or reorder with the arrow keys on a row's grip, with Remove; the other views below with Add to bar; "Views" instead of "0 more views"; a ⌘K / Ctrl+K hint; the panel moves right when its button is near the left edge, and is a bottom sheet at 640px and narrower.
- **Reports PNG export** has no logo or date on the picture: the chart under its title, as it looks on screen (the file name carries the date).
- **Not built:** moving a view between screens (duplicate it there instead).
- **Parity.** Not tracker related.
