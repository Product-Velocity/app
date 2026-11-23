---
issue: 390
status: done
logged: 2026-11-09
done: 2026-11-09
title: Grid and Cards have separate saved views, customised defaults and view bars
---
Ashu (2026-11-09): changing a view on the Cards screen changed the Grid's Delivery columns. The two screens must not share views: each has its own set (Grid view 1, 2, ... and Cards view 1, 2, ...). Done: `surface` on `saved_views` and `view_layouts` (migration `20261109225431_view_surfaces.sql`), the Grid's Delivery columns restored from the audit log. Decision: `docs/decisions/2026-11-09-grid-and-cards-views-separate.md`.
