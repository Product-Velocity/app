---
date: 2026-11-24
by: Ashu (2026-11-24, chat), built by Claude
request: 663
---
**The expand/collapse button steps through the nesting levels of a grid: each press is the next action, then it reverses.** Closing goes from the deepest level up (collapse level 3, then 2, then 1), opening from the first level down (expand 1, then 2, then 3), then it starts again. With one level it still toggles everything.

- **Levels.** Group by (level 1), Then by (level 2) and, with Show issues, the issues under each initiative; levels with nothing to fold are skipped. The other bars (Changes, Alignment, Accounts) read the level from the group key (the number of `>`).
- **State.** The set of collapsed keys is the state; the button remembers the direction. Folding by hand in between is respected: closing takes the deepest level that is not fully folded, opening takes the first level that has anything folded; at either end it turns round. After "expand level 1" the deeper levels are still folded, which is what shows the step.
- **Label.** "Collapse level 2 (sub-groups)", with the step in the tooltip ("step 3 of 4"); with one level the old wording ("Collapse all groups").
- **Also fixed the same day.** The search field in the grid bar showed an inner and an outer frame again (#663): the global `input:not(..):not(..):not(..)` rule has higher specificity than the bar's override, so the override now repeats the `:not()` chain (a test compares the specificity). The Changes report grid now fills the page below it like every grid (`useFillHeight`, #663 follow-up) instead of a fixed 70vh/640px cap.
