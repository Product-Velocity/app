---
bump: minor
---
**Change phase: any phase can be chosen.** "Move to next phase" is now "Change phase" and lists every phase, saying what each one needs. If a move passes a decision gate you are allowed to decide, it happens at once with a comment and is recorded as skipped (fast lane); if you cannot decide that gate, it offers Request gate instead. Claude still cannot move a phase past a gate. Migration `20261125173153_change_phase_fast_lane`.
