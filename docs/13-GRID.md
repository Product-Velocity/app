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
- **Keyboard:** Alt+N adds an initiative, arrows move, Enter or F2 edits, Enter saves and moves down, Tab saves and moves right, Esc cancels, Delete clears an optional cell.

## Quick-add (issue #7)
A row above the grid. **Alt+N** puts the cursor there (⌥N on a Mac); type, press **Enter**, the item appears at the end of the list at once and is saved in the background; the cursor stays for the next one. Only the name is required.
- **Tokens** (anywhere for `#` and `@`, at the end for the rest): `#project` (letters of the name, spaces ignored, a unique start is enough), `@person` (start of the email name), a size in capitals `XS S M L XL`, and `must`, `should`, `could`, `won't`/`wont`. Example: `Faster search #market @bo M should`. A token that matches nothing, or more than one thing, is explained and nothing is added. The line shows how it was read ("Project: Marketplace · Product Manager: bo@… · Effort: M · MoSCoW: Should") before you press Enter.
- **Context:** without `#project` the item goes to the project of the row you are on in the grid; otherwise the project you used last; otherwise the only project there is. (Saved scopes and the scope switcher come with #9 and will then be the context.)
- **Paste a list:** several lines pasted into the row add one item per line (bullets and numbers removed, up to 200). Lines with a bad token are skipped and listed; the rest are added as one undo step.
- **Similar-item hint:** while typing, up to three existing items that share most of their words are shown ("Looks similar to: R-07 …"). It never blocks.
- **Undo:** adding is one undo step; undo deletes the items again (ranks close up), redo adds them back at the end with new codes.
- **Audit:** the database records each new item (and every field) with who and source "UI". Not available to view-only roles.
- Plain text only: whatever is typed or pasted is a name, never an instruction. Pasting an email for AI intake is Phase 4.
- Admins can add a project by name from the Roadmap page (a minimal stand-in until project setup exists), because an item needs a project.

## Not in this issue
Multi-select bulk edit and paste-import (#8), saved views, column reorder and pinning (#9), editing tags, links, files and relations (item panel, phase 2).

## Tests
Controller and domain unit tests, Supabase source tests with a fake client, 20 browser tests (`pnpm --filter web exec playwright test` against a build with `NEXT_PUBLIC_E2E_HARNESS=1`, test page `/dev/grid`): keyboard, pickers, dates, locked cells, undo of 20, failed saves, rank, view-only, 2,000-item speed, accessibility (axe, WCAG A/AA).
