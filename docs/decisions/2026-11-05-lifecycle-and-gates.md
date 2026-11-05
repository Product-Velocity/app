---
date: 2026-11-05
by: Ashu
request: 323
---
**One lifecycle, three gates, decided by people, with the tracker handover and the end of sync defined by the lifecycle.** This replaces G1 to G4 everywhere (PRD, data model, field dictionary values, Help) and refines `2026-10-28-status-alignment.md` (item 5), `2026-10-29-initiative-status-completed.md` and `2026-10-28-discovery-flow.md`.

## 1. Phases
Discover, Define, Build, Test, Experiment, Roll-out, Completed. Label-only rename: Beta-test becomes Test in values and labels; the dictionary keys (`start_beta`, `time_beta_days`) stay. **Sunset is removed for now**; existing Sunset rows become Completed.

**Completed follows Initiative Status.** When a person sets Initiative Status to Completed, Initiative Phase becomes Completed (and the date is recorded). Only Completed is set this way; On hold and Cancelled leave the phase where it is. Moving the status back to Active restores the phase the item had before (read from the audit log). This reverses the direction in `2026-10-29-initiative-status-completed.md` (the phase no longer leads). It stops initiatives from sitting on Roll-out forever: a person closes them, the phase follows.

## 2. Gates
- **Gate A**: Discover to Define. The discovery document is approved.
- **Gate B**: Define to Build. The PRD is approved. **Gate B approval is the PRD approval**; documents are never approved anywhere else. Passing sets Initiative Phase to Build and the item shows **Ready for build** until the tracker reports work started.
- **Gate C**: Experiment to Roll-out. Decides whether the initiative may roll out (yes or no).
- The +30/60/90 outcome review is not a gate (scheduled reviews after Roll-out). G4 is retired. `current_gate` values become A, B, C.
- Moves without a gate (Build to Test, Test to Experiment, Roll-out to Completed) are made by a Creator or above; stage validation still applies. When the tracker says Build Status Done (closed as completed), Needs attention **suggests** Build to Test; it is never automatic.

## 3. Signal, decide, complete
1. **Signal**: anyone with Creator or above requests the gate. Gate Status becomes In review. The app shows a checklist (required fields for the stage, document status) as information. Claude may prepare the gate pack.
2. **Decide**: a person with approval rights chooses Go, Go with conditions, Hold or Stop with a rationale (immutable, append-only `gate_reviews`). Conditions become tracked tasks. **No auto-pass.** Stop sets Initiative Status to Cancelled and offers the confirmed tracker close, as in the "close removed" decisions.
3. **Complete**: one transaction writes the decision, sets Initiative Phase and phase dates, sets the document status (Gate A: discovery, Gate B: PRD) to Approved, sets Ready for build at Gate B, and writes the audit entry. The tracker handover is offered, never sent without confirmation.

## 4. Fast lane and jumping phases
**No checks and no thresholds in the flow.** There is no Effort or Confidence rule. The approver who decides may choose a later target phase and mark the decision **Fast lane**, with a comment. Skipped phases and gates are recorded as "Skipped (fast lane)" with the approver, the comment and the time. Safety is the user's choice first; the record exists so reports can show how often it was used. Gate B is a normal decision like the others, not special-cased in code.

## 5. Who can approve
Approval rights are configured per gate (A, B, C) in workspace settings: any account can be given them, **Admins have them by default**, and **an approver can approve their own request**. Claude, service accounts and staff impersonation never can (CLAUDE.md rules 3 and 10).

## 6. Decisions screen
A screen called **Decisions** next to My work and Needs attention (not in Reports; Reports keeps gate history and time at gate). It is about gates and approvals, not "mine": filters Waiting for approval (default), Decided, Requested by me, Can decide; each row shows who can decide. Any person with approval rights can act; the first decision wins and the others see the row closed (version-checked). A request may name preferred approvers, who are notified; others with rights are not blocked. The peek panel opens the gate pack with J and K. The multi-select bar gets Request gate, Decide (one shared rationale stored on each item's row, confirmation listing every item) and Move to next phase. The Initiative Phase cell becomes read-only; the bar and menu are the only ways to move it.

## 7. Spec Status removed
The PRD includes the spec, so `spec_status` goes (dictionary, grid, views, MCP tools, column, via a forward-only migration). `ready_for_build` stays computed (Not ready, Requested, Ready) from Gate B state; `ready_for_build_by` and date are set by the Gate B decision. **Ready for build** is a state, not a phase: Define time ends at the Gate B date; Build time starts at `start_building` (first tracker work in progress); the gap is a team-level "ready to start wait".

## 8. When items sync to GitHub and Jira (same for both, tracker parity)
- **Discover**: never synced (discovery is analysis).
- **Define**: optional, per item, confirmed "Request engineering review" pushes the allowlisted fields only (name, summary, description, hypothesis) with a `pv:define` label while the PRD is In review. Comments stay in the tracker; PV does not read them.
- **From Gate B**: full handover (create or adopt, children, Build Status and progress back).
- **Test to Roll-out**: continues.

## 9. When sync stops
**14 days after Initiative Status becomes Completed or Cancelled** the link is Frozen after one final sync. Frozen links are skipped by the daily check, Check now, the Sync dialog and the Jira refresh; webhooks for them are acknowledged and not stored. An approver or admin can Resume sync; moving the status or phase back unfreezes it. Freeze and resume are audited. Build Status Done alone never freezes (rule 6). Default views hide Completed initiatives (an "include completed" filter brings them back) so the grid loads less.
