# Cards (issue #28)

Open **Cards** in the header (`/cards`). Phase 2, on the same items, rules, autosave and undo as the grid.

## The board
- **Columns** by one field, **swimlanes** by another. Both lists offer the single-select fields people edit (Initiative Phase, Roadmap Category, MoSCoW, Health, Horizon, Focus Area, Decision, Effort, Audience, ...), plus **Initiative Group** (the workspace's open list), **Project** and **Team**. **Initiative Status** is offered too but comes from GitHub: you can view it, not drag across it.
- **Default: Initiative Phase by Initiative Group.** The issue names Planning Status, but that field arrives in phase 5; it is listed (disabled, "arrives in phase 5") and becomes the default column field automatically once it ships (`defaultColumnField`).
- Every value of the field is a column, plus **No value** (when the field may be empty). A value that is not in the list still gets a column. Lanes: all values of a select field, the workspace's groups, projects or teams, plus No value. Lanes with no cards start collapsed; all lanes collapse and expand. Counts on every column and lane.
- A card shows its **global rank and code, name, health as a word, owner, effort size and team chips**, in compact style. When a **saved view** is chosen in "Filters of", up to three more of that view's columns appear as lines on the card.
- Respects the **scope switcher** (`?scope=`) and the **filters of a saved view** (`?view=`). Settings are in the address (`by`, `lane`, `view`, `item`).
- Click a card (or Enter on it) to open the **item panel** beside the board; Esc closes it.

## Moving cards
- **Drag** a card to another cell: the column field changes if the column differs, the lane field if the lane differs. Dropping on a **lane heading** changes the lane and keeps the column. **No value** clears the field (refused for a field that cannot be empty, such as Project). One undo step for both fields; Ctrl+Z / ⌘Z undoes it, Shift+Ctrl+Z redoes it.
- **Read-only axes:** GitHub-driven fields (Initiative Status) cannot be used as the drag target. A drop across such an axis is refused with the reason ("Initiative Status comes from GitHub ..."), and a note above the board says so; a move across the other axis still works. The same for **Team** lanes (an initiative can have several teams: change them in the item panel). View-only roles can look, not move, and the footer says why.
- **Keyboard:** focus a card with Tab. **Shift+←/→** moves it to the previous or next column, **Shift+↑/↓** to the previous or next lane (the focus stays on the card, a live message says what happened or that it is at the edge). **M** (or the **Move…** link on the card) opens a menu with a column list and a lane list and a Move button, for any cell.
- Saves are in the background like in the grid; a failed save puts the card back and the strip says why.

## Tests
Domain unit tests (`cards.test.ts`: axes, values, board, planMove, keyboard neighbours), controller tests for `editFields` (several fields, one undo step, refused values, failed save) and a browser spec (`e2e/cards.spec.ts`: board, field choice, lanes, scope and filters, drag, lane drops, read-only axis, keyboard, Move menu, failed save, view-only, item panel, axe, 600 cards).
