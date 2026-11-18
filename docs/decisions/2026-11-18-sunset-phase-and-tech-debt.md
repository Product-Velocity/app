---
date: 2026-11-18
by: Ashu (Refinery89 roadmap review, 2026-11-18), written by Claude
request: 500
status: built, to confirm
supersedes: "Sunset is removed for now" in 2026-11-05-lifecycle-and-gates.md
---
**Sunset is a phase again, after Completed, and Change Type gets a fourth value, Tech debt.** Ashu compared the Refinery89 roadmap (R98 v3.4) with the field dictionary and chose: no KR register (OKRs stay Objective, Business Line and one Primary KR), the three status fields for the R98 status column, Sunset back, Tech debt added, and a direct database import for the first load.

- **Phases** are now Discover, Define, Build, Test, Experiment, Roll-out, Completed, **Sunset**. Sunset means a shipped feature is being retired. It has no gate and no start date column. A Creator can choose it from Roll-out or Completed (`move_phase`); from an earlier phase the database still answers `PV006` (the move would cross a gate). Moving back out of Sunset is allowed like any move back.
- **Completed keeps following Initiative Status**, with one exception: a Sunset item keeps Sunset when its status becomes Completed (an insert with status Completed and phase Sunset also keeps Sunset). Without this, the next status edit would pull the item back to Completed.
- **Finished work:** Needs attention, Leadership and the stage check treat Sunset like Completed (no stalled, no missing-field reminders). The timeline chart and the dictionary list it. Hide-completed in the grid is unchanged (Completed only).
- **Change Type** allows New feature, Improvement to existing feature, Bug and **Tech debt**. The tracker label is `pv:type/tech-debt` (GitHub and Jira share `changeTypeLabel`, so parity holds). No organisation issue type is guessed for it. **Not built:** pulling in a `type:tech-debt` label as Change Type (the two pull-in SQL functions are not replaced here; say if wanted).
- **Direct import.** An insert or update by the database owner (no signed-in user) is not refused by the phase guard, so Ashu's fresh import can set any phase, including Sunset, without gate history. The flags in the app work from the rows: Needs attention already shows "Cancelled but building", "Completed with open work" and "Phase ahead of the build". Nothing new was added to flag the import.
- **R98 mapping used for the sheet** (`Refinery_Roadmap_v3.4_PV_import.xlsx`, not committed: real company data): Backlog and Not Started become Planning Status; On Track, At Risk, Delayed and Blocked become Health with Initiative Status Active; Paused becomes On hold; Cancelled and Completed stay. Beta-test becomes Test. A Completed status with another phase gets phase Completed (the database does this anyway). R98 Type Feature, Improvement and Tech debt become Change Type; Check and Not classified stay empty.
- **Migration** `20261118132442_sunset_phase_tech_debt.sql`: two check constraints, `phase_index`, `items_system_fields`, `move_phase`. No data change.
