---
date: 2026-11-18
by: Ashu (request 494), built by Claude
status: built, to confirm
---
**Help is a set of pages at `/help` that open in a new browser tab, not a dialog.** The Help icon in the top bar is now a link with `target="_blank"`.

- **Six topics, in this order:** Goals and impact, Lifecycle and decision gates, Alignment, Reporting, Delivery platforms, AI co-workers. Each page is short: cards, lists and a "Where" line that says where to find the feature in the app.
- **Long tables live in a Reference section** (Ashu, same day) and the topic pages point to them: Fields and how they sync (all 171 columns, with filter), Goal and outcome fields, Phase by phase, Sync steps and status rules, Needs attention reasons, Reports and how numbers are counted, AI use-cases and documents, Connect an AI assistant, Keyboard shortcuts. A test keeps topic pages to three tables or fewer and checks each pointer.
- **No sign-in needed.** Like `/privacy` and `/connector`, the pages explain the product and hold nothing of a workspace. The header has "Open the app" to go back.
- **The text still comes from `help-content.ts`** for the tables that already existed (the column table is built from the field dictionary), so the field and sync wording has one source. The old dialog (`help-guide.tsx`, `help-menu.tsx`) is removed.
- **OKRs are described as the product has them today:** Business Line and Objective are two independent open lists, one primary key result per initiative, outcome columns and the Outcomes view. There is no goal tree, no company-goal field and no outcomes screen yet, and the page does not claim them.
- **Reporting is described as built:** Leadership view and weekly update, the four reports, saved views. Slide/PDF exports and customer-safe reports are named as planned, not offered.
- **Wording follows the brand guide:** "AI co-workers" in the framing, Claude, ChatGPT and Gemini named as examples, people decide, no competitor claims.
- **Claude features update Help:** the rule in `CLAUDE.md` now points at the AI co-workers, AI use-cases and Connect an AI assistant pages.
- **Not done:** the older wording "Jira is planned" inside the columns note and some Jira cells ("Not read yet") is unchanged; it is out of this request. Help is English only.
