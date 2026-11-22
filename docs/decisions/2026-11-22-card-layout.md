---
date: 2026-11-22
by: Ashu (issue #601), written by Claude
status: built
---
**A card has four zones and room for five chosen fields.** Replaces "up to three extra fields as lines" in `docs/17-CARDS.md`.

- **Zones.** Header: stack rank (a small grey badge, no `#`), initiative ID (opens the panel), the GitHub issue (`#42`) and the Jira key (`PLAT-7`) as links that open in a new tab, and health as a word pill. Name (two lines). The chosen fields. Footer: owner (avatar and name), time in stage, the `⋯` menu (Open, Move…, Copy link).
- **Five fields.** Health, rank, ID, name and owner are always shown and use no slot. The picker says "Card fields N of 5", greys the rest when full, previews a real card and sets the order (drag or arrows). Fields that are a column or swimlane of the board are not repeated. Long types (long text, links, files, relations) are not offered; a search says why.
- **How a field is drawn follows its type.** Select and tags: pill. MoSCoW: pill by weight (Must solid blue, Should light blue, Could grey, Won't outlined), no new hue because health owns green, amber and red. Effort: the size circle. Date: `Mar 12`. Percent: progress bar. Number: figure. Person: avatar chip.
- **Insight.** A 3px edge in the health colour (the word stays). Days in stage when over half of the usual limit (the Needs attention limits; "over" past it), about the initiative, never a person. Sizes per column ("3L 1M"). A health bar with words per lane. A "Drop here" zone while dragging.
- **Where it is stored.** In the view's column list (core columns, then the fields), so saved views keep working; the grid shows the same columns.
- **Parity.** GitHub and Jira IDs both shown and linked; only http(s) links are followed.
