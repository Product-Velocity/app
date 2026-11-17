---
date: 2026-11-12
by: Ashu ("export to XLSX and retain the formatting"), written by Claude
status: built
---
**The grid's Export button offers an Excel file (.xlsx) next to the CSV, and the menu is no longer cut off.**

- **The bug.** The Export menu opened inside the grid bar, whose row has `overflow: hidden` (issue #403), so only the pointer showed and nothing could be clicked. The grid bar's row now lets its menus open below it; what does not fit is still hidden by the bar's own More logic.
- **What the Excel file keeps.** The same columns and rows as the CSV (selected rows, else the rows the filters show). Dates are real dates in your date format, numbers are real numbers (thousands separators, `%` and `pp` units), Yes/No for booleans, people by email, project by name. A "Tracker issue" column sits beside Initiative ID and holds the GitHub issue or Jira key as a clickable link (both trackers, parity). The header row is bold, frozen and filterable; text starting with `=` stays text.
- **Dependency.** `exceljs` 4.4.0, MIT licence, no cost, loaded in the browser only when someone picks the Excel entry. Chosen because it writes dates, number formats and hyperlinks; nothing leaves the browser.
- **Not in this slice.** Links-type fields (artifacts, GitHub links) still export as text. Fixing the CSV's date columns to the person's format was not asked and is unchanged (CSV keeps ISO dates).
