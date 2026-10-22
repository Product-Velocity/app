# Product Velocity — Product Requirements

Status: pre-build. Scope tags: **[R1]** first release, **[R2]** next, **[LATER]** parked. Anything untagged is R1.

## 1. Positioning
One-liner: *Product Velocity is the AI-first product management platform for fast-moving teams, where AI and human teams plan, align, build and learn together.*
Tagline options: "From idea to launch, at AI speed." / "One roadmap for humans and AI." Pillars: **Clarity, Alignment, Velocity**. Story: **decide → deliver → learn**, with transparency across all.
First audience: **enterprise buyers** (confirmed 2026-10-21). ICP wording: "fast-moving product teams inside larger organisations".
Caveat: AI agents are **not** yet counted as capacity; do not market "AI and human teams" capacity planning until [R2] adds agent capacity.

## 2. Users and roles
Tenant → Projects. Roles: **Viewer, Commenter, Creator, Admin**, plus separate **Approver** permission (only Approvers record Gate 2 / mark "Ready for build"; Claude can never hold it), plus **Leadership viewer** (portfolio-level read). Alignment **Participants** are external-style guests (magic link, no account). Billable seats = Creator/Admin/Approver (see `09`).

## 3. Core concepts
- **Project**: team, repo(s), GitHub setup. **Portfolio** is a *scope*, not a container: default "All projects" plus saved named scopes.
- **Item (initiative)**: home project + contributing teams. One **global Stack Rank** per planning cycle and portfolio; project views show the filtered order ("#3 globally, #1 in Platform").
- **Fit line**: per team. An item is above the line only if every team it needs has room (effort by skill vs the team's new-work capacity).
- **Planning cycle**: phases Candidate selection → Alignment → Commit → Prepare → Execution → Review.
- **Decision gates** G1 Worth exploring, G2 Commit to build (Approver), G3 Ready to launch, G4 Outcome review (+30/60/90 days).

## 4. Feature areas

### 4.1 Roadmap grid [R1] (prototype boards 1, 20)
Portfolio grid with global/in-project rank, per-team fit chips, quick-add, inline edit, bulk bar, Gantt and card views (boards 3, 4), item peek/detail (2). Field list in `03-DATA-MODEL.md`.

**Full column set (requirement).** Every field in Ashu's grid sheet (`Roadmap_v3_field_dictionary_proposal.xlsx`) and in `03-DATA-MODEL.md` must exist as a grid column in the final platform. The prototype shows only a subset on purpose: the grid has a **Columns** picker (show/hide, reorder, pin), and saved views choose which columns appear (e.g. Prioritisation, Planning, Delivery, Go-to-market, Outcomes, Leadership). Nothing is dropped; fields are only hidden by default. Column visibility respects role and audience rules (e.g. commercial fields hidden from customer-safe views). Fields not yet delivered in a phase appear as columns when their phase ships. The Excel dictionary predates teams, planning cycles, gates, outcomes and reports, so reconcile it against `03` before Phase 1 and treat the union as the column list.

### 4.2 GitHub sync [R1] — `04-GITHUB-SYNC.md` (boards 2, 6)
GitHub App; tracking issue per initiative; epics and tasks as sub-issues; status/assignees/progress flow back. Breakdown routes: Traditional, In between, Full Claude.

### 4.3 Spec and readiness [R1] (board 13)
Item documents (link or MD file; versioned; draft/in review/approved/linked). Definition-of-Ready checklist. "Request approval" → Approver → "Ready for build". Epic/task proposal.

### 4.4 Claude / MCP [R1] — `05-AI-AND-MCP.md` (boards 5, 14)
Remote MCP server as the signed-in user. AI intake (paste email/notes → draft items with duplicate check). Guardrails and "via Claude" audit.

### 4.5 Planning cycles [R1] (board 18)
Candidate pool tags: Carry-over, Likely carry-over, Deferred, New, Backlog. Triage minimum (hypothesis, rough value, rough effort). Capacity check (typical demand 2–3× capacity). "So far" stats (committed vs actual, commitment kept). Fields: Planning Status, Cycle, Deferred Count, Previous Rank, Added After Commit, Deferral Reason.

### 4.6 Capacity [R1] (boards 15, 16)
Teams (e.g. Marketplace, Consumer app, Bidder, Host-read ads) with members, hours, skill split, time split (e.g. 25 maintenance / 25 bugs / 50 new), focus factor (80%), time off, serving projects, GitHub team link. New-work capacity = hours × focus × new-work share. Units: person-weeks, monthly. Effort by skill per item; weights XS 2 / S 4 / M 8 / L 14 / XL 24 person-weeks (defaults, editable). Plan-vs-actual from GitHub; estimate accuracy. Engineers split across two teams **[R2]**. AI agents as capacity **[R2]**.

### 4.7 Alignment [R1: ranking sessions; R2: four dimensions] (boards 8, 9–12, 17, 19)
R1 methods: top-5 + duels, **100 coins**, ICE sliders. 100 coins: 100 per person, max 30 per item; group score = average coins normalised so the group's top item = 100; groups combined with equal weight (default) or headcount; joint score scaled so top = 100. Segments (role/region/customer type); <5 voters hidden; magic-link per ballot; participants see anonymous results; admin sees names. Invitations drafted by Claude, sent only after user confirmation. Mobile participant screens (390×844).
R2: **Why / What / How / When** per item with states Not started, In review, Aligned, Contested, Overdue; sign-off Approve / Approve with concerns / Block (a block is never averaged away); stakeholder lists including customers; decision log; customer concept review (customer-safe brief, "Does this solve your problem?", "What is missing?"); customers as a segment (anonymised or by account; ARR weighting off by default). *Lenses / agreement rings were rejected — do not build.*

### 4.8 Decision gates [R2] (board 22)
Criteria auto-evaluated by the app (e.g. fits capacity) or confirmed by people. Outcomes: Go / Go with conditions / Hold / Stop with immutable rationale; conditions become tracked tasks. Auto-pass when criteria met and no objection; fast lane for small items (G2 only); gate pack (Claude may prepare, only Approver decides). Fields: Current Gate, Gate Status, Next Gate Due.

### 4.9 Reports [R1 basic: 3 templates; R2: all] (board 21)
Engine = template + scope + audience profile + format. Audience profiles control field visibility (customer-safe, participants, go-to-market, leadership, internal). Built-in branded templates: Roadmap for sales, Pre-vote briefing, Go-to-market launch deck, Monthly business review, Alignment results, Roadmap data export. Formats: PPTX, DOCX, XLSX, PDF (HTML print view). Snapshots with history. Claude drafts narrative; human reviews. Scheduled drafts [R2]. Custom template upload and native Google/SharePoint [LATER].

### 4.10 Velocity insights [R2] (board 23)
Cycle time per phase, throughput, commitment kept, estimate vs actual, scope added, deferral rate, blocked/waiting time at gates, bug share vs plan, optional DORA. "Opportunities to improve": ranked, with evidence and suggested action, written by Claude from data; the user decides. Team-level only. "Did it work?" follow-up.

### 4.11 Outcomes and adoption [R2] (board 24)
Key-result live values (manual / CSV / API / webhook / Claude; analytics connectors LATER), adoption %, time to first use, retention, predicted vs actual value, customer feedback linked, outcome reviews at +30/60/90, learning loop back into the next candidate pool. Fields: Outcome Status, Adoption %, Review Date, Realised Value.

### 4.12 Leadership view and weekly update [R1] (board 7)
Portfolio health, weekly update drafted by Claude, reviewed by a human.

## 5. Non-functional
Multi-tenant isolation; audit log; undo; accessibility AA; performance target: grid with 2,000 items per project interactive <200 ms for edits (optimistic); import/export; EU data residency option [LATER]; SAML SSO [R2, enterprise]; 2FA [R1].

## 6. Efficiency patterns (build first, they define the product)
Quick-add (tokens `#project @person M should`, context inheritance, paste a list to add many, paste an email to run AI intake, duplicate hint while typing); inline editing with typed pickers and plain-language dates; autosave + undo (no staged Save bar); keyboard navigation; peek panel with J/K; ⌘K; saved views; multi-select bulk bar; paste from Excel with mapping; drag to re-rank and move Gantt bars; AI ghost suggestions in empty cells; conflict highlighting.

## 7. Success measures (pilot: one team, one quarter)
Hours saved on reporting; planning-cycle time; commitment kept; time to add an item (<10 s); weekly active members.

## 8. Out of scope for now
GitLab (next after R1), Jira import, native Google/SharePoint output, analytics connectors, agent-as-capacity, individual metrics, Lenses.
