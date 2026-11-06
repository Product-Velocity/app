# Decision gates and the lifecycle

Status: decided 2026-11-05 (issue #323, `docs/decisions/2026-11-05-lifecycle-and-gates.md`). Built in the slices listed in section 11. This is the page to read to understand how an initiative moves, who decides, and when it syncs to GitHub or Jira.

## 1. The lifecycle in one picture

```
Discover ──A──▶ Define ──B──▶ Build ──▶ Test ──▶ Experiment ──C──▶ Roll-out ──▶ Completed
   │                                                                              ▲
   └─ never synced ─┘└ optional review push ┘└────────── synced both ways ────────┘└ frozen 14 days later
```

Phases: **Discover, Define, Build, Test, Experiment, Roll-out, Completed.** (Test was called Beta-test; Sunset is gone for now. The field keys `start_beta` and `time_beta_days` keep their names.)

| Phase | What happens | Evidence | Ends with |
|---|---|---|---|
| Discover | Objective, problem, evidence, candidate solutions; people choose one | Discovery document | **Gate A** |
| Define | PRD, alignment on why/what/how/when, estimate, rank | PRD, alignment, effort | **Gate B** |
| Build | Engineers deliver in GitHub or Jira | Build Status, progress, PRs, CI (read-only) | A Creator moves it to Test |
| Test | Limited release to check that it works | Health, notes | A Creator moves it to Experiment |
| Experiment | Test with a population against a threshold written beforehand | Rollout plan in the PRD | **Gate C** |
| Roll-out | Widen to markets and customers | Customers live, adoption | Initiative Status set to Completed |
| Completed | Outcome reviews at +30, +60, +90 days | Outcome fields, learning | (end) |

**Completed follows Initiative Status.** Setting Initiative Status to Completed moves the phase to Completed, so nothing sits on Roll-out forever: a person closes the initiative and the phase follows. On hold and Cancelled never change the phase. Setting the status back to Active restores the phase the item had before (from the audit log).

## 2. The three gates

| Gate | Between | Question | Passing does |
|---|---|---|---|
| **A** | Discover and Define | Is this worth defining; is the discovery solid? | Approves the discovery document; phase becomes Define |
| **B** | Define and Build | Do we commit to build it? | Approves the PRD; phase becomes Build; **Ready for build** shows until the tracker starts; offers the tracker handover |
| **C** | Experiment and Roll-out | Did the experiment pass; may it roll out? | Phase becomes Roll-out |

- **Gate B approval is the PRD approval.** A document is never approved anywhere else. There is no Spec Status field any more: the PRD includes the spec.
- The outcome review at +30, +60 and +90 days is **not** a gate.
- Between gates, moves (Build to Test, Test to Experiment, Roll-out to Completed) need a Creator or above, and stage validation (required fields per stage) still applies. When the tracker says the build is done (closed as completed), Needs attention **suggests** moving to Test; one click accepts it. Nothing moves by itself.

## 3. Signal, decide, complete

1. **Signal (Request gate).** A Creator or above requests the gate on one item or a selection. Gate Status becomes **In review**. A checklist shows the required fields for the next stage, the document status and (gate B) capacity fit. It informs; it does not block. Claude can prepare the **gate pack** (a summary of the evidence and the checklist) through the MCP server; it cannot request-and-decide.
2. **Decide.** A person with approval rights for that gate chooses **Go, Go with conditions, Hold or Stop** and writes a rationale. The rationale and the decision are append-only (`gate_reviews`). You may approve your own request. If several people can decide, the first decision wins; the rest see the request closed. A request may name preferred approvers, who are notified (section 6a); others with rights are not blocked.
3. **Complete.** One database transaction: the decision row, Initiative Phase and `phase_changed_at`, the phase start date, the document status (A: discovery, B: PRD), `ready_for_build` and who/when (B), Gate Status and Current Gate, and the audit entry. Then the tracker handover is *offered*, never sent without a confirmation.

| Outcome | Effect |
|---|---|
| Go | Phase moves. |
| Go with conditions | Phase moves; each condition becomes a tracked task (`gate_conditions`) shown on the item and in Needs attention until done. |
| Hold | Phase stays; Gate Status Held; an optional review date goes to Next Gate Due. |
| Stop | Phase stays; Initiative Status becomes Cancelled; the confirmed "close the tracker issue" offer appears (same words as the removed-initiative decisions). |

Gate Status describes the gate the item has to pass next (Current Gate): Not started, In review (requested, checklist incomplete), Waiting for Approver (requested, checklist complete), Held, Stopped. After a Go the item has a new Current Gate and its status is Not started; what was decided stays in `gate_reviews` (outcome, rationale, who, when) and open conditions stay on the item. "Passed" and "Passed with conditions" are allowed values that the app does not set today. The checklist the requester sees is stored on the request (`criteria`, `ready`); it never blocks a decision.

**No auto-pass.** Criteria are evaluated and shown, and Approvers are notified that a request is ready, but nothing passes without a person.

## 4. Fast lane (jumping phases)

There are no thresholds and no safety checks in the flow. The person who decides may pick a **later target phase** and tick **Fast lane**, with a comment. The skipped phases and gates are stored as decisions of kind "Skipped (fast lane)" with the approver, the comment and the time, and reports can count how often it was used. What is safe to skip is the approver's judgment. Moving backwards (for example Test back to Build) is allowed for a Creator; the gate state resets.

## 5. Who can approve

Per gate (A, B, C), in Settings, Workspace: a list of accounts. **Admins can approve by default** and any account can be given approval rights. An approver may approve their own request. Claude, service accounts and staff impersonation can never decide (CLAUDE.md rules 3 and 10). The database refuses it, not only the app.

## 6. The Decisions screen

A screen named **Decisions** in the main navigation next to My work and Needs attention. It is about gates, not about one person. Filters: **Waiting for approval** (default), **Decided**, **Requested by me**, **Can decide** (rows this person has rights to decide). Columns: item, gate, requested by and when, checklist result, who can decide. The peek panel shows the gate pack; J and K move through rows; the keyboard decides (G go, C go with conditions, H hold, S stop, each asking for the rationale). A badge on the nav entry counts the requests this person can decide.

Reports keeps the *history*: decisions per gate, time waiting at a gate, Hold counts and how often fast lane was used (team level only, rule 8).

## 6a. Notifications (issue #341)
An in-app inbox, a **Notifications** button with an unread count in the top bar. The database writes the rows (triggers on `gate_reviews`), so every route notifies the same way:

| Event | Who is told | Opens |
|---|---|---|
| A gate is requested | The people the requester named, if they can decide that gate; otherwise everyone who can (Admins, the Approver permission, the gate's list). Never the requester, never a service account. | Decisions |
| A decision is made | The requester (not when they decided it themselves). The request is marked read for the other approvers. | The initiative |
| A request is withdrawn (the phase moved back) | The requester. The approvers' notices are marked read. | The initiative |

A notification holds the initiative code and name and the gate; the rationale, documents and commercial fields are never copied into it (the decision is read in Decisions). The request dialogs have an optional "Ask these people" list. The bell polls every minute and when the tab comes back; a person marks their own notices read (one, or all). Claude and service accounts neither receive nor mark notifications. **Email and Slack are not sent:** sending to people needs an explicit confirmation (CLAUDE.md rule 3), so email is a later, opt-in step with its own design.

## 7. The multi-select bar

- **Request gate** (Creator and above). The items must be in the same phase. The bar says "5 of 7 ready" and requests the ready ones; the others are listed with what is missing.
- **Decide** (approval rights). Go, Go with conditions, Hold, Stop on the selected items that are waiting. One rationale, stored on each item's own immutable row. A confirmation lists every item. Fast lane and a target phase are available here too.
- **Move to next phase** for the moves without a gate.
- The **Initiative Phase cell is read-only** in the grid and in paste/import. The bar, the item panel and ⌘K are the only ways to move a phase.

## 7a. Needs attention (issue #337)
The **Needs attention** tab (`/attention`) lists the initiatives of the current scope that need a person to look, worst first, then by Stack Rank. The rules are `attentionList` in `packages/domain/src/attention.ts`; every entry says the reason in words and, where there is one, offers the next step in one click. A mismatch is a suggestion, never an automatic change; the buttons use the same functions as the grid (Move to Test through `move_phase`, Request gate through `request_gate`).

| Reason | When | Next step |
|---|---|---|
| Delivery risk | Health Blocked, At Risk or Delayed; G2M date passed; blocked issues (the leadership list) | Open the initiative |
| Build done | Build Status Done (closed as completed) while the phase is Build | Move to Test |
| Work before the gate | Build Status In progress or Done while the phase is Discover or Define | Request the gate |
| Cancelled but building | Initiative Status Cancelled while Build Status is In progress | Open; stop the work in the tracker |
| Hold due | `next_gate_due` of a Held gate is today or earlier | Request the gate again |
| Waiting for a decision | An open gate request older than 7 days | Open Decisions |
| Open conditions | `gate_conditions` not done | Open the initiative |
| Stalled in a phase | Active, days in phase beyond 30 (Discover, Define, Test), 45 (Experiment), 60 (Roll-out), 90 (Build) | Open the initiative |

Limits are defaults in `STALL_DAYS` and `GATE_WAIT_DAYS`; Roadmap Health shows the real distribution. All of it is about an initiative or a team, never a person (rule 8). J and K move through the list and Enter opens the initiative. The tab has no count badge, because counting needs the whole project, which the page loads; the count is on the screen.

## 8. When items sync to GitHub or Jira

The same for both trackers (`docs/decisions/2026-11-03-tracker-parity.md`).

| Phase | Sync |
|---|---|
| Discover | Never. Discovery is analysis; the ranked options are not initiatives. |
| Define | Optional, per item, confirmed: **Request engineering review** pushes the allowlisted fields only (name, summary, description, hypothesis) and a `pv:define` label while the PRD is In review. Comments stay in the tracker; PV does not read them. |
| From Gate B | Full handover: create or adopt the issue, children, Build Status and progress back. Build Status counts from here (rule 6 stays: a closed ticket is a finished build, not a finished initiative). |
| Test, Experiment, Roll-out | Continues. |
| Completed or Cancelled | Frozen after a 14-day grace period (section 9). |

Commercial fields never sync (rule 2). A gate decision, its rationale and its conditions are commercial; they are never in any payload (a test checks it).

## 9. When sync stops

**14 days after Initiative Status becomes Completed or Cancelled**, one final sync runs and the link becomes **Frozen** (`frozen_at`). A frozen link is skipped by the daily check, "Check now", the Sync dialog selection and the Jira refresh; webhooks for it are acknowledged and not stored. An approver or admin can **Resume sync**; moving the status back to Active (or the phase back) unfreezes it automatically. Freeze and resume are audited. Build Status Done alone never freezes anything. The default views hide Completed initiatives (an "Include completed" filter brings them back) so the grid loads less.

## 10. Data

- `gate_reviews(item_id, gate A|B|C, kind decision|skipped, outcome go|go_with_conditions|hold|stop, rationale, fast_lane, target_phase, decided_by, decided_at, requested_by, requested_at)`: append-only; rationale immutable.
- `gate_conditions(review_id, item_id, text, due, done_by, done_at)`.
- `tenant_gate_approvers(gate, user_id)` and the workspace default "admins can approve".
- `items.current_gate`, `items.gate_status`, `items.next_gate_due`, `items.ready_for_build_by/_at`; `spec_status` is removed.
- `item_github_links.frozen_at` and the Jira twin.
- Every table: `tenant_id`, RLS with the fast policy pattern, an index starting with `tenant_id`, and a two-tenant test.
- The audit log records requests, decisions, fast-lane skips, freeze and resume with actor and source.

## 11. What is built (issue #323) and what is not

Built:
1. Names and docs: phases, gates, Help (this page).
2. Gate tables, approver configuration, request, decide and complete functions, phase guard, Completed follows status, RLS and tests (`20261105160035_phase_values_test_completed`, `20261105160804_decision_gates`).
3. The Decisions screen (`/decisions`), the Decisions tab with its count, Request gate / Decide / Move to next phase in the bulk bar and the item panel, the read-only Phase cell, the Build-to-Test and Hold-due suggestions in the item panel, who-can-decide settings, ⌘K "Go to Decisions", cards dropped on a phase column move through the gate source.
4. Tracker handover: Discover is never given a new issue (GitHub and Jira); an initiative in Define carries the label `pv:define`; the Gate B result tells the person to use Sync, which still asks for confirmation.
5. Freeze and resume (`20261105164327_tracker_freeze`): the daily job freezes finished initiatives, every check, webhook and Sync path skips frozen links, the item panel offers Resume syncing; Completed initiatives are hidden in the grid unless "Include completed" is on.
6. Claude: the read-only `get_gate_pack`; no tool can request, decide or move.

Not built yet (each is a follow-up request, not a hidden gap; the browser specs that main had left behind were fixed in the first follow-up):
- ~~**Notifications** to preferred approvers~~ built in-app (issue #341, section 6a). Email and Slack are not built; they need an opt-in with an explicit confirmation.
- **Stop closes the tracker issue**: Stop sets Initiative Status to Cancelled and the result says Sync handles it; the dedicated confirmed "close the issue" offer from the removed-initiative decisions is not wired to Stop.
- ~~**Needs attention** as a screen~~ built (issue #337, section 7a). The "My work" half of #105 is not built.
- **Reports** for gate history and time at a gate; the ready-to-start wait is derivable (Gate B date to `start_building`) but has no report yet.
- **A separate "Request engineering review" button**: the review push is the normal confirmed Sync of an initiative in Define (it carries `pv:define`); a dedicated button and a PRD-in-review condition were not added.
- The grid hides Completed initiatives but still loads them; a server-side limit on what is loaded is a later change.
- ~~⌘K commands for the bulk gate actions~~ built (2026-11-05, follow-up): with rows selected, ⌘K offers Request gate, Decide and Move to another phase, which open the same dialogs as the bulk bar.
