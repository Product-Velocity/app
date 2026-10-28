# Claude writes a PRD and creates the initiative (R-112)

Status: spec, written 2026-10-28 from Ashu's decisions in chat. Builds on `docs/20-CLAUDE-MCP.md` (slices 1 to 5) and `docs/05-AI-AND-MCP.md`. Nothing here is built yet.

## 1. What this is
A person asks Claude (through the Product Velocity MCP server) to "write a PRD and create the initiative". Claude follows a fixed PRD structure, creates the initiative, fills every field it can **support from what the person said**, asks one short batch of questions for the rest, and stores the **full PRD as a document on the initiative**. The full PRD never goes to GitHub; the Description carries only an extract.

Every module is optional. A PRD that has nothing for a module leaves it out: no empty heading, no warning, no effect on anything else.

## 2. Principles
1. **Never guess.** A field is set only when the person's own words or an answered question support it. No invented numbers, thresholds, dates, customers or competitor claims (rule 9).
2. **Skip is free.** "Skip" is a valid answer to any question and is never asked twice in the same run.
3. **People-only fields stay people-only** (rule 3), with one narrow exception: Value Type (section 6).
4. **The full PRD is data in PV, not on GitHub** (rule 2). Which module goes where is fixed in the template (section 4), not judged by Claude.
5. Everything Claude writes is an AI draft, audited with source `Claude MCP`, and undoable with `undo_last`.

## 3. PRD structure
**Core (always, as in Ashu's current PRDs; not changed):** title and "Depends on" line, 1 Executive Summary, 2 Relationship to other initiatives (only when there is one), 3 Problem Statement, 4 Scope, 5 Prerequisites / Phase 0, 6 Functional Requirements, 7 Acceptance Criteria, 8 Risks and open questions, 9 Phasing.

**Section 1 gets an "At a glance" block** (two short bullet lists, three to five bullets each, no more):
- **What we will build**
- **What we will not build**

Rules: the bullets must agree with section 4 (Scope); Claude writes section 4 from them, or them from section 4, in one pass so they cannot drift. "Will not build" is never empty: if the person named nothing, Claude asks once ("anything you want to rule out?") and otherwise writes "Nothing excluded yet". Both lists are GitHub-safe and go into the Description extract.

**Appendices (4D modules, each optional):** lettered after section 9, titled like "A1 Company Value Story". Section 1 points to them in one line, and only when at least one is present.

| Module | Flag | Content | Fields it can fill |
|---|---|---|---|
| **A1 Company Value Story** | PRD only | The company goal served (new revenue / grow existing revenue / save costs / other), **how** the initiative moves it (mechanism), assumptions and the evidence for each, cost of not doing it. Replaces "Business Value Map". | Primary KR (name, unit, direction, start, target), Cost of Not Doing, Focus Area, Roadmap Category, Change Type; Value Type only under section 6 |
| A2 Feature Value Map | PRD only | Customers, end users, current products and services | Request Origin, Target Segments, Audience, Related To |
| A3 User Value Map | PRD only | Persona, current journey, pain points, AI opportunities | feeds the two copy blocks below |
| A4 AI Solution Hypothesis | PRD only | Options evaluated (diverge), decision matrix (converge), recommended option | none; Decision, Decided By, Decision Date stay with people |
| B1 UX Flows & Wireframes, B2 Prototype Screens | links | Future workflow, AI interactions, launch scope | Artifacts (`add_link`), Screenshots (`add_file`), Tags |
| B3 Initial Master Prompt, B4 Evaluation Plan | PRD only | Tone, inputs, instructions, examples, output format; quality criteria, typical / edge / negative cases | none |
| C1 to C9 Model Selection, Input Specifications, Output Checklist, Final Master Prompt, Data & RAG, Evaluation Set, Test Results, Edge-Case Handling, Evaluation Automation | PRD only | As in the 4D template | none (Spec Status and Agent-ready are set by people) |
| **D1 Rollout Plan** | PRD only | See section 5 | Start Experiment, Start Roll-Out, Roll-out %, Target Markets, Target Segments, Target Customers, Next Review Date |
| D2 Operational Readiness | PRD only | Technical, organizational | Dependencies / Blockers, Contributing Teams, Depends On, Effort, Estimate low / high (basis "Rough guess") |
| D3 Go-to-Market | PRD only | Marketing assets, internal communications | GTM / Enablement Notes, Audience, Target Customers |
| D4 Legal & Risk | PRD only | Data, privacy, policy, compliance | Dependencies / Blockers, a tag |
| D5 Success Metrics | PRD only | User, business and AI-performance metrics | Primary KR fields; outcome fields are filled after launch by people |
| D6 Support & Feedback, D7 Continuous Improvement | PRD only | Channels, escalation, feedback workflow; monitoring, learnings, updates | GTM / Enablement Notes |

Which modules Claude offers: an AI feature gets all four phases; other work gets A1 to A3, D1, D3, D4, D5 as they apply; the person can name modules ("add Legal & Risk") or remove them.

**Two blocks Claude copies word for word into fields**, at fixed places in the PRD:
- **Hypothesis** (IF / THEN / RESULTING IN), in section 3, into the Hypothesis field.
- **Customer value proposition (customer-safe)**, in A1 or section 1, into Value Proposition. Written to the brand claims rules (`docs/17-WEBSITE-AND-BRAND.md`), no invented competitor claims, no commercial figures.

Both are AI drafts. If the field already holds a value, the existing diff-and-confirm flow applies.

## 4. Where each part goes
| Part | Where | Reaches GitHub? |
|---|---|---|
| Full PRD (core and appendices) | Document of kind `prd` on the initiative (V12 Documents), versioned | **Never** |
| Description (Markdown, 20,000 characters) | Extract of the modules flagged "GitHub-safe": At a glance, sections 1, 3, 4, 5, 6, 7, 9. Marked "From PRD v<n>". | Yes (existing allowlist) |
| Hypothesis, Value Proposition, other fields | Copied or derived as in section 3 | Hypothesis yes (already allowlisted); the rest as `docs/04` says |
| Sections 2 and 8 | PRD only by default (risks and open questions can be commercial) | No |

When the PRD changes, Claude offers to refresh the Description extract; the field already has a value, so it comes back as a diff that needs confirmation.

## 5. Rollout Plan (D1): a pre-registered experiment ladder
The module is a table, written **before** launch. One row per experiment:

| Experiment | Goal | Population | Metric and threshold | If outcome 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|---|---|
| 1 | Validate it works, squash bugs | internal / pilot | e.g. no severity-1 bug | stop | rethink | widen | go on |
| 2 | A/B-test | city / market / customer / persona A, B, C | e.g. conversion difference | stop | rethink | widen the population | go global |

Rules:
- Claude drafts the structure. **Thresholds and decision rules come from the person.** Anything not given is written "to define" and listed in the questions; Claude never fills a number.
- Dates and populations map to the fields above. The checkpoint date goes in Next Review Date.
- After each experiment the outcome review (Phase 5) compares the actual result with the rule written beforehand. People set Outcome Verdict and Learning.
- Later option, not in this spec: each experiment as a child initiative with Depends On.

## 6. Value Type exception to rule 3 (decided 2026-10-28)
Claude may set **Value Type only** (for example new revenue, grow revenue, save cost), and only when the person stated it or answered Claude's question about it. It is not inferred from tone.
- The tool requires a `basis`: the person's own words. The audit log stores it; the field shows as an AI draft the person can change.
- Value, Value Basis, Confidence, Time to First Revenue, Customers Requesting, Stack Rank, Decision and the gate fields stay people-only, still refused by the tools and by `items_guard` (`PV004`).
- Build: migration relaxing `items_guard` for `value_type` alone, `describe_fields` reporting it as `claude_may_set` with the `basis` requirement, tests that every other forbidden field is still refused, and that a call without `basis` is refused.

## 7. What Claude asks
After reading the person's brief, Claude lists what it could not fill, **once, in one message**, grouped by module and ordered by importance, each with "skip" allowed. It asks only for fields not already answered by the text. Typical set: Sponsor, Product Manager, Primary KR, G2M Quarter, Effort, Value Type, thresholds in D1. Answers are used in the same run; unanswered items are left empty (nothing is blocked by a missing field; validation by stage comes with #101 and will then be shown as warnings).

## 8. Build slices
1. **Documents on the initiative.** Table `item_documents` (+ versions) with RLS, indexed from `tenant_id`, two-tenant test, added to the probe list in `packages/db/tests/rls.test.ts`; audit; Documents tab in the item panel (read, edit, versions); the field stays off the GitHub allowlist and the sentinel test proves it.
2. **MCP document tools.** `write_document`, `update_document` (carries the version it was based on; a newer human edit is never overwritten), `get_document`, `list_documents`. Read results are wrapped as data. Same role gate (creator and admin write), daily limits and `undo_last`.
3. **Value Type exception** (section 6).
4. **`write_prd` prompt and server instructions.** The MCP server advertises `prompts` and `instructions` (today `capabilities` has only `tools`, `apps/web/src/lib/mcp/rpc.ts`). The prompt holds the template, the At-a-glance rule, the modules and flags, the "never guess" rules and the single batch of questions. Golden-input evals for the prompt.
5. **Extract and copy.** Tool-side helper that builds the Description extract from the flagged modules and copies the Hypothesis and Value Proposition blocks, with the diff rule.
6. **Scenario test.** One end-to-end test: a short brief → initiative, document, extract, copied fields, one question batch, a skipped module; plus hostile text in the brief and the document (data, not instructions), and a check that no PRD-only module text appears in any GitHub payload.

## 9. Open points
- Should customers (read-only roles) see the PRD document? Proposal: same visibility as the initiative, creators and admins write.
- Do approvers need a "PRD approved" status separate from Spec Status? Proposal: reuse Spec Status.
- Template editable per workspace: later, not in this spec.
