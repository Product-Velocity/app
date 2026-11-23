---
date: 2026-11-23
by: Ashu (request in chat), built by Claude
request: 622
status: built, to confirm
---
**The Gantt gets views, and the Reports get PNG and PDF export.** One migration.

- **Same view bar as the Grid and Cards.** Three default views, reusing the names of the first three grid views as Cards does: Prioritisation (the Gantt as it was), Planning, Delivery. Planning and Delivery filter by Initiative Phase; no date-relative filters, so a view never goes stale.
- **What a view keeps on the Gantt:** its filters, Group by, Then by, zoom and row height, in a new nullable `saved_views.gantt` (jsonb object; same RLS, audit trigger and grants pattern as `widths`). Search and the name-column width stay personal. Row height used to be a per-browser setting; it is now part of the view (the address and the last choice still carry it across a reload).
- **Shared names, shared overrides.** Because the defaults reuse grid names, an admin's "Update for everyone" on a default customises that name for the Grid, Cards and Gantt alike (its columns, filters and Gantt settings are separate fields, so none breaks another). Same behaviour Cards already had.
- **Views saved elsewhere** open on the Gantt with their filters; the Gantt settings fall back to defaults.
- **Reports, one chart to PNG.** Each chart has "Export PNG" (visible on hover or focus, always on touch screens): the chart on a white sheet under its title, with nothing else added (no logo, no date; the file name carries the date). ECharts charts are read from their SVG; the stacked bars (plain HTML) are drawn from their numbers. Done in the browser; nothing is sent anywhere. Fonts in a PNG fall back to the system font for the ECharts text.
- **Reports, whole page to PDF.** "Export PDF" on every report (it replaces the disabled "PDF summary (later)" button on Overview) holds the page at a print width, opens the print window, and the person chooses Save as PDF (PDFs come from an HTML print view; no server job). The sheet is A4 landscape, hides the menus and filter bar, and says the report, date, counts and filters in words at the top. Cards are not split across pages.
- **Not built:** a server-made PDF (for scheduled or emailed reports), a customer-safe PDF (reports are still internal), PNG of the Gantt in a report.
- **Parity.** Not tracker related.
