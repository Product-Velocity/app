---
issue: 246
status: done
logged: 2026-10-28
title: Focus Area and Audience move from fixed values to free format
---
Ashu asked that Focus Area (and then Audience) stop being fixed lists and work like Initiative Group: free text with suggestions from the values in use ("yes, both fields should become open with suggestions"). Built as open lists without a new table: the field dictionary has no allowed values for them, the grid, panel, bulk bar, filters, cards, reports and the Claude MCP tools suggest the values in use and keep one spelling per value. Details in `docs/13-GRID.md`; the migration only swaps the old value checks for a 120-character limit.
