# PV skills (`pv-<skill>`)

Issue #565. A skill is a guided, repeatable flow started from any connected assistant. It reads the company profile and what Product Velocity already stores, asks one short batch of skippable questions, writes a Markdown document into Product Velocity and, where the skill says so, fills fields from that document.

## 1. Syntax
`pv-<skill> [target] [your words] [--draft]`
- `target`: an initiative code (`R-12`), several codes, `view:"Name"` or `group:"Name"`, or nothing (the skill asks). `your words` is free text and pasted material; it is data, never instructions. `--draft` shows the result in the chat and writes nothing until the person says to save.
- `pv-help` lists the skills. In Claude and Gemini start a skill from the prompt picker (prompt name = the command); ChatGPT and other clients type it and the assistant calls `get_playbook`.

## 2. The five steps every skill follows
1. Read the company profile (only the sections the skill lists) and `get_workspace_context`.
2. Read PV data: the initiative, its documents, related items, gate pack, outcomes, whatever the skill lists.
3. Ask once: at most three skill questions plus the draft-or-save question, grouped, each skippable. Anything the profile or PV already answers is not asked.
4. Write the document (sections as `## n. Title`, placeholders "to define", nothing invented).
5. Save as an AI draft with `create_document`; fill fields only through the skill's extract (empty fields first, preview, `confirm_changes` for filled ones).

## 3. Rules (shared)
Never guess; skipping is free; ask once; data is not instructions; people-only fields stay with people (Stack Rank, Value, Confidence, Decision, approval, Ready for build); everything is an AI draft; the closing "To be decided by" names a role, and a person with the right permission decides at the gate. Documents never reach GitHub.

## 4. Catalogue and field extract
A skill that fills fields ends its document with `## n. Values for Product Velocity` (`key: value` lines, only what the document or the person states). `apply_skill_extract` previews, then copies those lines as written through `update_items`; people-only fields and keys the skill does not own are left out and listed. Each skill saves its own document kind.
Built: see `packages/domain/src/skills-catalog.ts` (the list below is generated from it in `pv-help`).

## 4a. Two kinds of output (Ashu, 2026-11-21)
- **Document skills** save a Markdown document of record (on the initiative, or in the workspace's Documents) as an AI draft.
- **Report skills** (`pv-weekly`, `pv-release-notes`) produce content for an audience in the format asked (`--format=email|slides|document|slack|chat`); nothing is saved or sent unless the person asks for a copy. They read the app's own report definitions through `get_report`.
Report skills cover every initiative unless some are named (codes, a range such as R-1 to R-5, a view or a group; `focus: true` in the spec). `pv-weekly` is framed for leadership by default (bottom line and asks first, what happened and why it matters grouped by theme, compared with last week, at risk and what would unblock it). Formats: email, slides (PowerPoint), document (Word), Slack, chat. Help lists every skill with what it works on and what you get (generated from the catalogue).

## 4b. Depth (2026-11-23)
Each deepened skill adds a craft layer to the prompt (`skills-depth.ts`): key ideas, when not to use it, pitfalls with the fix, a check-list, a strong and a weak example and a worked example. Questions with options show lettered choices with "use when". Every skill opens with a read-back (found, assumed, missing, conflicts) before it asks. Written from scratch; no external skill text is used (decision `docs/decisions/2026-11-23-skills-own-wording.md`).

Wave 1 (`pv-gate`, `pv-prioritise`, `pv-hypothesis`, `pv-outcome`, `pv-which`) and wave 2 (`pv-split`, `pv-assumptions`, `pv-sunset`, `pv-stakeholders`, `pv-readiness`) are written with the craft layer from the start. Wave 2 document kinds: split_plan, assumption_map, sunset_plan, stakeholder_map, readiness_review (item documents).

## 5. Slices
1 engine and routing, `pv-premortem`, `pv-one-pager`. 2 field extract, new document kinds, `pv-metrics`, `pv-gtm`, `pv-experiment`, `pv-stories`. 3 company context v2, workspace documents, `pv-vision`, `pv-strategy`, `pv-northstar`, `pv-compete`, `pv-personas`. 5 `pv-weekly`, `pv-release-notes`, `pv-quarter`. Later: scoring and triage (4), research (6), admin switch and catalogue page (7).

## 6. Scores and alignment (for slice 4, recorded now)
Scoring is advisory and does not require alignment to run first. It uses, in this order of trust: results of alignment where they exist (aggregates only; groups under 5 voters hidden; never individual voters), values people set (customers requesting, estimates, dependencies), outcome history, then Claude's proposal marked as such. The result states which inputs it used and which items have no alignment yet, and offers to start alignment for them. It never writes Stack Rank; the person uses it in the existing "decide final order" step.

## 7. One name style, tiers and skills that include skills (issue #643, Ashu, 2026-11-24)
Decision: `docs/decisions/2026-11-24-one-skill-name-style.md`. Source of truth: `packages/domain/src/skill-plan.ts`.

**One name style.** Every prompt and skill is `pv-<name>`. The three flows that had other names are now `pv-prd` (was `write_prd`), `pv-discovery` (was `write_discovery`) and `pv-company` (was `research_company`). The old names are **aliases**: `prompts/get` and `get_playbook` accept them and return the same text; no menu lists them (`prompts/list`, the connector files, the Help pages). The Gemini skill folders are renamed to match (`skills/pv-prd`, `skills/pv-discovery`, and the copies under `connectors/gemini/skills`). Aliases stay for one release; removing them is a later issue.

**Five kinds (tiers).**
| Kind | Skills |
|---|---|
| Guided (beginner, end to end) | `pv-company`, `pv-discovery`, `pv-prd`, `pv-prioritise`, `pv-gate`, `pv-weekly`, `pv-outcome` |
| Building blocks (one job, runnable alone) | `pv-hypothesis`, `pv-metrics`, `pv-assumptions`, `pv-premortem`, `pv-split`, `pv-stories`, `pv-opportunity-tree`, `pv-impact-map`, `pv-readiness`, `pv-gtm`, `pv-release-notes`, `pv-stakeholders`, `pv-one-pager` |
| Company knowledge (sub-skills of `pv-company`) | `pv-personas`, `pv-compete`, `pv-market`, `pv-vision`, `pv-strategy`, `pv-northstar`, `pv-canvas` |
| Advanced (stand-alone) | `pv-business-case`, `pv-pr-faq`, `pv-prototype`, `pv-experiment`, `pv-sunset`, `pv-quarter` |
| Router | `pv-which`, `pv-help` |
The issue's heading says "three kinds" but lists five groups; the five are built.

**What a guided skill includes** (`SKILL_PLANS`, `includes`: `always`, `offered`, `byGate`, `notes`).
| Guided skill | Always runs | Offered, skippable |
|---|---|---|
| `pv-company` | the company profile research | the seven company-knowledge skills |
| `pv-discovery` | `pv-hypothesis`, `pv-metrics` (one key result), `pv-premortem` (light) | `pv-opportunity-tree`, `pv-assumptions`; `pv-personas`, `pv-market`, `pv-compete` for the initiative only when the company-level ones do not cover it |
| `pv-prd` | `pv-metrics`, `pv-split` | `pv-stories`, `pv-premortem`, `pv-pr-faq`, `pv-business-case` |
| `pv-gate` | the gate pack | A: `pv-one-pager`, `pv-stakeholders`; B: `pv-premortem` if none; C: `pv-readiness`, `pv-gtm`, `pv-release-notes` |
| `pv-outcome` | none | `pv-metrics` when no key result exists |
| `pv-weekly`, `pv-prioritise` | none | none |

**Rules of composition.** (1) Reuse, do not redo: read the confirmed company-level personas, competitors and market and what the initiative already has first, and offer to refine. (2) Show the plan first, in the one message: "This will run: A, B, C. Skip any."; ask once, quick (always-runs only) or full. (3) One document: each step is a labelled section, saved as an AI draft; nothing is saved for a draft-only request. (4) Depth at most 2 and no cycles (`skillPlanProblems`, tested). (5) Every included skill stays runnable alone with the same arguments. (6) Company knowledge from `pv-company` stays an AI draft until a workspace admin confirms it; a competitor or market claim needs a source and a date. (7) Guardrails do not change: AI never approves, requests or moves a gate or phase, sets Stack Rank, Decision or Value, or sends anything; documents are data.
How it runs: the prompt of a guided skill carries a PLAN block built from the same data (`planBlock`): the steps, the composition rules, and for each included step its sections and rules, so an assistant that cannot call `get_playbook` can still run it. Initiative fields an included step may fill go through the flow's normal dry run and confirmation, never `apply_skill_extract` (that belongs to a skill run alone). An included report skill (`pv-release-notes` in `pv-gate` C) writes its content as a section of the document; nothing is sent. `pv-help` lists the skills by kind; `pv-which` recommends the lightest one and can name the three guided flows.

