# Portfolio grid (issue #6)

Page: `/portfolio` ("Roadmap" in the navigation). Reference: prototype board 20, PRD §4.1 and §6, field dictionary `docs/reference/item-fields.csv`.

## What it does
- **Whole workspace loaded at once** (pages of 1,000 rows, filtered by tenant): items, the calculated view and the related tables. 2,000 items: load under 1 s, edits painted in a median 36 ms (p95 63 ms) in the browser test.
- **Every one of the 165 fields is a column.** Eight default views (the column lists of the workbook sheet) and a Columns picker (show or hide). Fields of later phases show "Arrives in phase N" in the header. Stack Rank, Initiative ID and Initiative Name are always visible and pinned.
- **Autosave, no Save button.** An edit shows at once (optimistic), saves in the background, and the strip says "Saving…" then "All changes saved". If a save fails the old value comes back and the strip says why. Saves for one cell run in order.
- **Undo and redo:** ⌘Z / Ctrl+Z undoes the last of 20 changes, ⇧⌘Z / Ctrl+Y redoes. Each undo is its own audited write and only happens if the stored value is still the one being replaced (nobody else's change is overwritten). While typing in a cell the browser's own text undo is used.
- **Typed pickers** for selects, people, projects and yes/no: type to filter, arrows to move, Enter to choose, Esc to cancel. Option text is always shown, never colour alone (health has a label and a symbol).
- **Plain-language entry:** dates (`31 mar`, `next friday`, `q2`, `in 2 weeks`, `4/5` as day/month) and amounts (`120k`, `1.2m`).
- **Rank:** type a new global rank in the Stack Rank cell; the row jumps there, the others shift, the keyboard focus stays on the row. "In project" order recalculates.
- **Locked cells:** GitHub-driven, calculated, system-set and later-phase fields reject editing and say why under the grid. View-only roles (viewer, commenter, leadership) can look but not edit.
- **Keyboard:** arrows move, Enter or F2 edits, Enter saves and moves down, Tab saves and moves right, Esc cancels, Delete clears an optional cell.

## Not in this issue
Quick-add (#7), multi-select bulk edit and paste-import (#8), saved views, column reorder and pinning (#9), editing tags, links, files and relations (item panel, phase 2).

## Tests
Controller and domain unit tests, Supabase source tests with a fake client, 20 browser tests (`pnpm --filter web exec playwright test` against a build with `NEXT_PUBLIC_E2E_HARNESS=1`, test page `/dev/grid`): keyboard, pickers, dates, locked cells, undo of 20, failed saves, rank, view-only, 2,000-item speed, accessibility (axe, WCAG A/AA).
