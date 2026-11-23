---
date: 2026-11-23
by: Ashu (request in chat), built by Claude
status: built
---
**Column widths belong to the view.**

- A width dragged in the grid is part of the view definition (`widths`, pixels by field key). Like other view changes it stays with the view until saved from the views menu; Save writes it to the saved view or the customised default view, "Reset view changes" drops it. Migration `20261123082059_widths_in_saved_views.sql` adds `saved_views.widths` (jsonb object, nullable; same RLS, audit trigger and grants pattern as `sort`).
- Why it jumped back: the column definitions were rebuilt with fixed default widths, which reset a dragged width. They are now built from the view's widths, so a width holds across redraws and scrolling.
- Widths are whole pixels clamped to 48–900; columns the view does not show are dropped. A dragged Initiative Name stops filling the free space (fixed width until reset).
- New default widths with a little room: MoSCoW 108, Health 118, Effort 112 (were 150, 130, 150).
- The Effort size circle is centred in its cell (it sat low and off-centre).
- **Parity.** View-level, no tracker difference.
