# Hierarchy, setups and how fields feed insights

Status: draft for Ashu's review. Items marked **[DECIDE]** need an answer before they are built.

## 1. The structure in one picture
**Workspace (tenant) → Project → Initiative → Epic → Task.**
- *Workspace*: one organisation. All data is isolated here.
- *Project*: a team, repo(s) and GitHub setup. Initiatives live in one home project.
- *Initiative*: the roadmap item. Epics and tasks are GitHub sub-issues below its tracking issue.

Everything else is an **attribute or a lens**, not a level:
- *Attributes of an initiative*: Initiative Group (theme), Roadmap Category, Target/Live Markets, Planning Cycle, contributing teams.
- *Lenses over the structure*: Portfolio scope (a saved selection of projects), Teams (capacity and fit line), saved views, audience profiles.

Rule of thumb: **levels answer "where does this live?"; attributes answer "what kind of work is it?"; lenses answer "which slice am I looking at?".**

## 2. Setups
| Setup | Workspace | Projects | Portfolio scopes | Groups / categories |
|---|---|---|---|---|
| **A. One product team** | 1 | 1 | "All projects" only | Groups = themes of the quarter; categories show the investment mix |
| **B. Several teams, one product** (the prototype, "Meridian Media") | 1 | One per team or product area, each with its repo | "All projects" for the global stack rank; project views show the filtered order ("#3 globally, #1 in Platform") | One shared group list so the portfolio groups consistently |
| **C. Shared teams across projects** | 1 | By product or repo | Per product line | An initiative has one home project plus contributing teams; the fit line is checked per team, so a shared platform team limits several projects at once |
| **D. Business units in one company** | 1 | Per BU or product | One saved scope per BU, plus "Company"; Leadership viewer sees the scopes | Categories are company-wide (same investment language); one open group list per workspace; BU-specific labels go in Tags |
| **E. Agency or several companies** | One per client or company | As needed | Within a workspace only | Separate lists. No roll-up across workspaces in R1 (isolation is the point) |

Choosing a setup: one project per repo-owning team is the default. Add projects when the team, repo or GitHub setup differs. Use scopes (not extra projects) to slice views.

## 3. How the other fields support insights
Insights are only as good as the fields behind them. Each insight below lists the fields it reads, and the question it answers. All are team or portfolio level, never individual.

| Question | Fields | Insight / view |
|---|---|---|
| Are we investing in the right kinds of work? | Roadmap Category (effort by category) | Investment mix, shown in Leadership and reports |
| Is effort concentrated or scattered? | Initiative Group, effort by skill, Stack Rank | Theme concentration, grouped grid / Gantt |
| Can we really deliver the plan? | Effort by skill and team, team capacity, fit line | Fit line, capacity vs demand (typical demand 2–3× capacity) |
| Is the plan stable? | Planning Status, Cycle, Previous Rank, Deferred Count, Added After Commit, Deferral Reason | Commitment kept, deferral rate, scope added after commit |
| Is scope creeping during delivery? | Planned Scope (#), Scope Added (#) (from sub-issues) | Scope growth per initiative and per team |
| Where does work wait? | GitHub status and dates, Current Gate, Gate Status, Next Gate Due | Cycle time per phase, time blocked or waiting at gates |
| Were our estimates right? | Effort estimate vs delivered (GitHub) | Estimate accuracy, plan vs actual |
| Where are we going to market? | Target Markets, Live Markets | Launch coverage: planned vs live markets |
| Did it work after launch? | Outcome Status, % Adoption, key results, review dates | Adoption, predicted vs actual value, +30/60/90 reviews, feeds the next candidate pool |

Sources (see `docs/reference/item-fields.csv` for exact keys and when each field ships): user input, GitHub sync (read-only in the app) and computed fields.

## 4. Rules that keep the narrative honest
1. Roadmap Category is a fixed list. Initiative Group is an open list per workspace: new groups are created as people type, with autocomplete and near-duplicate hints, and admins can rename or merge groups so insights stay clean.
2. Insights compare like with like: same cycle, same scope. Every insight states its scope.
3. Commercial fields (value, customers, outcomes) never sync to GitHub and are hidden from customer-safe views unless the audience profile allows them. Target and Live Markets are customer-safe (sheet flag, confirmed by Ashu); whether markets sync to GitHub is a separate question, and they are not on the outbound allowlist.
4. No individual metrics: all insights aggregate to team or portfolio level.
5. Claude writes the narrative from this data. People decide.

## 5. Open points
- **Decided 2026-10-22 (R-005):** Initiative Group is an open list shared per workspace (created on the fly, admins can rename and merge); Tags remain for other labels. Roadmap Category stays a fixed list of five values for now (admin-defined values later).
- Setup E (cross-workspace roll-up) is out of scope for R1.
- Prototype: add a short "how to set up" view to onboarding (not yet designed).
