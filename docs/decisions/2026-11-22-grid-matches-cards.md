---
date: 2026-11-22
by: Ashu ("do all, but keep date fields like dd/mm/yy"), built by Claude
status: built
---
**The grid draws a value the way the card does**, so one value looks the same on the board, the Gantt and the grid. Follows `2026-11-22-card-layout.md`.

- **MoSCoW** is a pill by weight (Must solid blue, Should light blue, Could grey, Won't outlined). **Effort** is the size circle. **Percent fields** are a thin bar plus the number. **Person fields** are an avatar and the name. A read-only field keeps its lock and reason.
- **Project** is a quiet grey chip (blue means state or priority); when the scope is one project it is plain text.
- **Stack Rank** is the small grey badge without `#` (editing and export still use the number); Rank in Project is muted.
- **Health edge:** a 3px edge in the health colour on the left of every initiative row; the health word stays in its column.
- **Dates are not changed.** They keep the account's date format (for example dd/mm/yy), not the card's `Mar 12` (Ashu, 2026-11-22).
- Initiative Name is medium weight (500) so the pills carry the emphasis; header resize handles are lighter; long Select and Text values say their full text on hover; Roadmap Category is wider.
- Tracker IDs next to the Initiative ID (GitHub `#42`, Jira key, new tab) were already in the grid. Shared drawings: `components/field-visuals.tsx`.
- **Parity.** Built for GitHub and Jira alike (no tracker difference).
