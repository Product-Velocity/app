---
date: 2026-11-25
by: Ashu
request: 679
---
**Change phase: any phase can be chosen.** "Move to next phase" showed only earlier phases and later ones up to the next gate, and did not say why the rest were missing (Discover offered only Completed).

1. The dialog is renamed **Change phase** and lists every phase except the current one. Completed keeps its own entry (it sets Initiative Status, decision 2026-11-25-completing-an-initiative); Sunset is offered from Roll-out and Completed only.
2. Each phase says what it needs. No gate: moved at once. Passes gates the person may decide (Admin, Approver, or on the gate's list): moved at once, comment required, recorded as one "Skipped (fast lane)" row per gate with approver, comment and time, the same record as a fast-lane Go. Passes a gate the person cannot decide: shown as "needs Gate X: request it", with a Request gate button.
3. Creators who are not approvers keep today's behaviour: no passing a gate by themselves. Gates stay an approval, not a suggestion.
4. Claude and service accounts never move past a gate (`PV004`); moves that pass no gate by Claude stay refused for other reasons as before.
5. The move does not approve documents; only a Gate A or B decision does. Undo does not undo a gate skip (the skipped rows are append-only).
6. Migration `20261125173153_change_phase_fast_lane` replaces `move_phase` (new optional comment argument).
