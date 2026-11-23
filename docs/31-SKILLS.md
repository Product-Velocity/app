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

## 5. Slices
1 engine and routing, `pv-premortem`, `pv-one-pager`. 2 field extract, new document kinds, `pv-metrics`, `pv-gtm`, `pv-experiment`, `pv-stories`. 3 company context v2, workspace documents, `pv-vision`, `pv-strategy`, `pv-northstar`, `pv-compete`, `pv-personas`. 5 `pv-weekly`, `pv-release-notes`, `pv-quarter`. Later: scoring and triage (4), research (6), admin switch and catalogue page (7).

## 6. Scores and alignment (for slice 4, recorded now)
Scoring is advisory and does not require alignment to run first. It uses, in this order of trust: results of alignment where they exist (aggregates only; groups under 5 voters hidden; never individual voters), values people set (customers requesting, estimates, dependencies), outcome history, then Claude's proposal marked as such. The result states which inputs it used and which items have no alignment yet, and offers to start alignment for them. It never writes Stack Rank; the person uses it in the existing "decide final order" step.
