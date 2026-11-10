---
issue: 403
status: in progress
logged: 2026-11-10
title: Grid action bar and header tabs overflow into a "More" menu on narrow screens
---
Ashu: when the screen is less wide the action bar items do not wrap but go outside the screen and the page scrolls sideways; add a "..." menu for the items that drop off. The header wraps correctly, but it may be better to keep it as is and put the Grid/Gantt tabs that fall out in a "..." menu.

Decided with Ashu: one reusable `OverflowBar` (`apps/web/src/components/overflow-bar.tsx`, fit logic in `apps/web/src/lib/overflow-fit.ts`). Action bar: Paste table, then Export, Include completed, Sync move first; search, filters, columns, group by, sort, status and undo/redo stay. Header: tabs overflow from the right, the open tab is pinned.
