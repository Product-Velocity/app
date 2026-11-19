---
date: 2026-11-19
by: Ashu (2026-11-19, chat), built by Claude
status: built, to confirm
---
**Five read-only Outcome reviews columns in the Roadmap grid.** Ashu chose the option with no new item columns: everything is worked out from the 30, 60 and 90 day reviews (`outcome_reviews`, `docs/decisions/2026-11-19-outcome-reviews.md`). No migration.

| Column (key) | What it shows |
|---|---|
| Next Outcome Review (`outcome_next_review`) | The due date of the earliest checkpoint nobody has recorded; empty when all three are recorded |
| Outcome Reviews Recorded (`outcome_reviews_recorded`) | "1 of 3" |
| Latest Realised KR Value (`outcome_latest_value`) | From the latest recorded checkpoint that has a value |
| Latest Adoption % (`outcome_latest_adoption`) | From the latest recorded checkpoint that has one |
| KR Progress (latest review) (`outcome_kr_progress`) | (value − KR start) ÷ (KR target − KR start), in percent to one decimal; empty when the start, the target or the value is missing or start equals target (a metric that should go down works, because the sign cancels) |

- **Only for initiatives in Roll-out or Completed that have a Start Roll-Out**, and not Cancelled; every other row is empty.
- **Registered like Flags and Actions** (N52 to N56 in `docs/reference/item-fields.csv` and `field-dictionary.json`, group "Outcome reviews", `Computed (read-only)`, not stored, not synced to a tracker, phase 1). The dictionary now has 179 fields. They are in the **Outcomes** view, after Initiative Phase, with `grid-views.csv` and `default-views.csv` updated.
- **How they are filled:** the grid reads the reviews once (and again when the panel moves to another initiative or closes, so numbers recorded there show up) and sets the five values on each row, so sorting, filtering, search and Export see what the cells show. A screen that has not read the reviews leaves them empty rather than showing a wrong value.
- **Not touched:** the dictionary's own phase-7 outcome fields (Outcome Status, Outcome Review Date, Realized KR Value and so on). They stay "arrives in phase 7"; this change does not make them editable or fill them. Say if any of them should now be computed from the reviews instead (for example "Outcome Review Date" from Next Outcome Review), which would retire the duplicate.
