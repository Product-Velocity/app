# AI assistants (Claude, ChatGPT, Gemini) and shared memory

Status: 2026-10-30, request #230 (R-112 "MCP client neutrality"), extended by Ashu's chat of the same day. **Built** (not deployed): the neutral server, ChatGPT and Gemini connectors, memory, group review, research check, playbooks. **Not verified live**: see section 9. Builds on `docs/20-CLAUDE-MCP.md`, `docs/22`, `docs/24`, `docs/26`.

## 1. What and why
One MCP server (`/mcp`) serves every assistant. Whatever a flow does, it does the same for Claude, ChatGPT and Gemini: same tools, same prompts, same rules, same role checks, same guards in the database. Only three things differ per client: how a person connects it, how the tool list is presented, and whether it can start prompts. A **shared memory** lets one assistant reuse what another learned.

## 2. How a client is recognised
`detectAssistant()` (`packages/domain/src/assistants.ts`) maps the OAuth client's registered name (or the User-Agent) to `claude`, `chatgpt`, `gemini` or `other`. It is a **label, never a permission**: the role check, the "Claude cannot approve / rank / decide / value" guards and the rate limits do not look at it. The database mirrors it in `assistant_of()` and `mcp_connections.assistant` (a test keeps both in step). Memory notes record which assistant wrote them.

| | Claude | ChatGPT | Gemini |
|---|---|---|---|
| Connect | custom connector / `claude mcp add` | Developer mode, custom connector (OAuth) | `gemini mcp add --transport http` then `/mcp auth` |
| Prompts | MCP prompts | not supported: `get_playbook` tool gives the same text | MCP prompts (slash commands) |
| Tool list | all tools | all tools + `search`, `fetch` (deep research, company knowledge; read-only; bare JSON shape, no data envelope, data note inside the text) | all tools, schemas simplified (`anyOf`, `const`, `additionalProperties`, `format`, `pattern`, `default` removed or turned into an enum / first branch; the server still validates strictly) |
| Setup text | `setupGuides()` renders the Connect page, `connectors/` has the files for Gemini (extension + `GEMINI.md`) and ChatGPT (guide), generated from the same rules and checked by a test |

With several workspaces in one connection, `search` ids carry the workspace (`<workspace id>~item:R-12`) so ChatGPT's `fetch` needs no extra argument.

## 3. Memory
Table `ai_memories` (migration `20261030001116_assistant_memory.sql`), RLS keyed by `tenant_id`, two-tenant tests, probe in `rls.test.ts`.
- **A note**: scope (workspace, group, initiative), kind (fact, term, partner, research, preference, lesson, open question), title (120), body (2,000), **source** (300, required: the person's words, the URL and date read, or the initiative and document), basis (person, source, document), up to 8 tags, status (draft, confirmed, archived), version, `verified_at`, which assistant wrote it. At most 1,000 live notes per workspace; one live note per title and place.
- **Who may do what.** Assistants (any OAuth token) write **drafts** only and cannot confirm, cannot archive or delete a note a person confirmed (`PV004`), and cannot delete at all. A change by an assistant to a confirmed note sends it back to draft. People with editor roles confirm, edit, archive and restore; admins delete for good. Audited (actor, source, time, old and new value). Never read by GitHub code (a test scans for it, rule 2).
- **What is refused** (`memoryTextProblem`, before anything is written): secrets, text that reads like an instruction to an assistant, what an individual participant said or voted (rule 7). Notes are data, never instructions (rule 4): recalled notes come inside the data envelope and the rules say so.
- **Tools**: `recall` (read; query, group, item, kinds; ranks by scope, title match, confirmation and freshness; flags stale partner/research/fact notes after 90 days), `remember` (write; create, or update with `id` and `base_version`; returns `exists` instead of a duplicate and `conflict` instead of overwriting), `forget` (archive a draft). `get_workspace_context` carries `memory: { total, by_kind, stale, unconfirmed }`.
- **In the app**: Memory (account menu, `/settings/memory`): list with source, state, assistant and age; Confirm, Edit, Archive, Restore, Delete for good.

## 4. Reuse
The flows start with `recall` and, after the person agreed to save, finish with `remember` (`MEMORY_RULE`, at most five durable notes, each sourced, one line per note in the closing message). Details of one initiative stay in its document. `setup_memory` seeds the memory once from the company profile and the largest groups' documents: up to fifteen candidate notes, the person picks, then they are saved.

## 5. Review of the other initiatives in the group
`review_group` (read) compares an initiative, or a brief that is not one yet, with the others in the same Initiative Group (`theme`). It returns siblings (closest wording first), findings that each carry evidence (`possible_overlap`, `missing_relation`, `same_name`, `date_conflict`, `dependency_unfinished`), `read_first` (at most five codes), the titles of their documents and the group's notes. It compares work, never people (rule 8), and never changes anything. `PRIOR_KNOWLEDGE_RULE` now says: recall, `review_group`, then read at most five documents. The `review_group` prompt is the stand-alone version ("does this fit what we planned?").

## 6. Research for discovery and PRD
`CONTEXT_RESEARCH_RULE` now starts with `check_research`: the assistant lists the partners and terms of the brief; the tool says which are **known** (a fresh note titled with it, or the company profile's partners / glossary / products / competitors), **stale** (older than 90 days) or **missing**; only stale and missing ones are researched, from public sources. Findings are kept with `remember` (kind partner, term, research) so the next run, by any assistant, finds them without an admin step; important partners are still offered to the company profile (`docs/26`, an admin confirms). Sense-check, "never invent", and "unverified" rules are unchanged.

## 7. Flows as prompts and as a tool
`apps/web/src/lib/mcp/flows.ts` is the one list: `write_prd`, `write_discovery`, `review_group`, `research_company`, `setup_memory`. `prompts/list` and `prompts/get` read it; `get_playbook` returns the same text for clients without prompt support. A test fails if a flow is missing from the Help page.

## 8. Decisions and what is left of request #230
- **Done here**: client-neutral wording on the Connect and consent pages, assistant label on connections, schema simplification for Gemini (a lint test fails if a forbidden construct appears), per-client tool lists, ChatGPT `search`/`fetch`, `connectors/` files, the confirmation controls stay server-side (diff id, preview id) so they do not depend on the client.
- **Deferred on purpose**: renaming the write source `Claude MCP` to `MCP` plus a client column (issue step 2). It touches audit history, many guards and saved filters, and needs Ashu's go-ahead on the data migration. Until then `Claude MCP` is the source name for **every** AI assistant, and the assistant is told apart by `mcp_connections.assistant` and `ai_memories.assistant`. See `docs/decisions/2026-10-30-assistant-memory-and-neutral-connectors.md`.
- **Needs the live Supabase OAuth server** (issue step 1): loopback redirects with a changing port for Gemini CLI (default callback `http://localhost:7777/oauth/callback`), a pre-registered confidential client for Gemini Enterprise, ChatGPT's redirect URIs (`https://chatgpt.com/connector_platform_oauth_redirect`, `https://platform.openai.com/apps-manage/oauth`).

## 9. [SPIKE] S8c, unverified
Nothing below has been tested against a real client, because nothing is deployed and the sandbox has no Supabase OAuth server or accounts: (1) ChatGPT Developer mode connects, completes OAuth and lists the tools; `search`/`fetch` shape is accepted by deep research. (2) Gemini CLI completes `/mcp auth` and accepts the simplified schemas; prompts appear as slash commands. (3) Gemini Enterprise accepts a pre-registered client. (4) The three `client_name` values really match `detectAssistant`. (5) Effective file-upload limits per client. Record the results in `docs/08` before relying on any of it.
