---
bump: minor
---
**Grid, Cards and Gantt each keep their own views, and the views panel is clearer.** A view, a customised default or the bar you arrange on one screen no longer shows on another, so changing the Gantt can't change the Grid. Existing views stay on the Grid; Cards and Gantt start with their ready-made views. The panel has a My bar / Workspace bar switch for admins, keeps the open view's Save and Reset buttons at the top, lists your bar first so you can drag views into order, and is a sheet on a phone. Exported report pictures no longer carry the Product Velocity mark or date. Migrations `20261109225431_view_surfaces.sql` (already in production, now in the repo) and `20261123170000_gantt_surface.sql`.
