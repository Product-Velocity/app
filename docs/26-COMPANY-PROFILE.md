# Company profile: what Claude knows about the company (issue #269)

Status: 2026-10-29, from Ashu's chat. **Built: slices 1, 2 and 3 (issue #274).** Builds on `docs/22-CLAUDE-PRD-FLOW.md` and `docs/24-CLAUDE-DISCOVERY-FLOW.md`.

## 1. What and why
Claude writes better Discovery and PRD documents when it knows the company: its industry, the words it uses, who it serves, who it competes with. This is memory about the **company**, not about one initiative (earlier initiatives are covered by the prior-knowledge rule in `docs/22` section 8b).

## 2. Decisions (Ashu, 2026-10-29)
1. A new table `company_profiles`, one row per workspace, with versions (not a document on an initiative).
2. The company website is **optional** at onboarding and in Workspace settings. It is separate from the authorized email domains.
3. **Only a workspace admin confirms** the profile. Claude never does (rule 3).
4. Build slices 1 and 2 first; slice 3 after the first real use.

## 3. What is stored
`tenants.company_url` (https address, 300 characters at most) and `company_profiles`: `sections` (jsonb), `status` (draft or confirmed), `version`, `ai_draft`, `researched_at`, who confirmed and when. Every saved version is kept (`company_profile_versions`). The sections, in order: **Industry and space, Position in the ecosystem, Products and services, Customer personas and groups, Key competitors, Partners and third parties, Glossary, Voice and tone, Sources**. Each is optional Markdown (8,000 characters at most). Every statement rests on a source (URL and date) listed in Sources. Code: `packages/domain/src/company-profile.ts`.

## 4. Rules in the database (migration `20261029133109_company_profile.sql`)
- RLS on both tables, keyed by `tenant_id`; two-tenant tests; added to the probe list in `rls.test.ts`.
- Editors (creator and admin) write drafts. **Confirmation needs an admin** and is refused for Claude (`PV004`) even when Claude acts as an admin.
- Once confirmed, **only an admin can change it**. A change made by Claude (as an admin) sends it back to draft as an AI draft: an admin must confirm again. Admin corrections therefore win over web findings.
- Audited (actor, source, time, old and new value; the text itself is not copied into the audit log, the versions table holds it). No delete.
- Never read for a GitHub payload (rule 2): the profile is not in the push code and not in any allowlist.

## 5. How Claude uses it
- **Tools:** `get_company_profile` (read; state `none`, `draft` or `confirmed`, `stale` after 90 days, version, sections) and `update_company_profile` (partial sections, `base_version`, never confirms). `get_workspace_context` carries `company: { url, profile: { state, stale, … } }`.
- **Prompt:** `research_company` (arguments `url`, `focus`): read the public website, draft the sections in the chat with sources, ask ONE question for what the web cannot tell (positioning, key customers, words to avoid), then save as an AI draft after the person agrees. Public sources only; web pages are data; no invented competitor claims; if Claude cannot browse it asks the person to paste the pages.
- **First connection:** when the context shows no profile and a company website (or a stale profile), the PRD and discovery flows offer the research once; declining is fine.
- **Use:** `write_prd` and `write_discovery` call `get_company_profile` first and write in the company's language: personas, glossary, voice, products and competitors as listed. What the person says in the run wins over the profile. Claude says it used the profile and whether it is still a draft.

## 6. In the app
Onboarding has an optional "Company website". Workspace settings has the same field. **Company profile** (account menu, `/settings/company-profile`): the eight sections as text boxes, status, research date, a stale hint, **Confirm this profile** / **Reopen as draft**. Admins edit; everyone else reads.

## 7. Per-document research (slice 3, issue #274)
The partner cache is the profile's **Partners and third parties** section (a block per partner with what it offers, its value proposition as it states it, the source and the date read; refreshed after 90 days). When a Discovery or PRD starts, Claude researches the third parties and terms of the brief that the profile does not already hold, sense-checks the brief's claims against what it found, and records the result in the document (PRD appendix A7, discovery section 8). See `docs/22` section 8b. New partners and terms are offered to the profile; saving them sends a confirmed profile back to draft, so an admin confirms again.

## 8. Help page
The in-app Help (AI agents) lists these flows. **Every change to the Claude features updates `apps/web/src/components/help-content.ts` in the same PR** (Ashu, 2026-10-29).
