---
date: 2026-11-15
by: Ashu ("how would you change the look and feel for the export button to be more clear"), written by Claude
status: built
---
**The grid's Export button says what it exports and what you will get.**

- Download icon plus chevron; the label is "Export", or "Export 3 selected" when rows are selected.
- The menu opens with a header ("Exporting 42 rows, with your filters, the columns you see") and one titled entry per file: Excel (.xlsx), CSV (.csv), Roadmap with epics (.xlsx), each with a one-line description.
- After a download the page shows "Downloaded <file> (N rows)".
- On a narrow bar Export now leaves for More after Include completed (rank 2 vs 3).
- Not in this slice: saving to OneDrive or Google Drive. Ashu asked to hold that back; it is a separate request (needs OAuth, encrypted tokens with RLS tests, audit, parity for both providers).
