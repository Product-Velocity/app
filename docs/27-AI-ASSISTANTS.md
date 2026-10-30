# AI assistants (Claude, ChatGPT, Gemini), AI tool and model on documents, document log, team block

Status: 2026-10-30, request #230 (R-112 "MCP client neutrality"). **Built, not deployed.** Builds on `docs/20-CLAUDE-MCP.md`, `docs/22`, `docs/24`, `docs/26`. Memory, group review and research-check tools were built first and then **removed** on Ashu's instruction: production already covers them with the company profile, the prior-knowledge rule and the context-research rule.

## 1. One server for every assistant
`/mcp` is the same for Claude, ChatGPT and Gemini: same tools, prompts, rules, role checks and database guards. `detectAssistant()` (`packages/domain/src/assistants.ts`) maps the OAuth client's registered name (or User-Agent) to `claude`, `chatgpt`, `gemini` or `other`. It is a **label, never a permission**. The database mirrors it (`assistant_of()`, `mcp_connections.assistant`, `current_assistant()`; a test keeps both in step).

| | Claude | ChatGPT | Gemini |
|---|---|---|---|
| Connect | custom connector / `claude mcp add` | Developer mode, custom connector (OAuth) | `gemini mcp add --transport http`, then `/mcp auth` |
| Prompts | MCP prompts | not supported: tool `get_playbook` returns the same text | MCP prompts (slash commands) |
| Tools | all | all + `search`, `fetch` (deep research, company knowledge; read-only; bare JSON, data note inside the text) | all, schemas simplified (`anyOf`, `const`, `additionalProperties`, `format`, `pattern`, `default` removed or turned into an enum or the first branch; the server still validates strictly) |

With several workspaces in one connection, `search` ids carry the workspace (`<workspace id>~item:R-12`) so `fetch` needs no extra argument. Setup text is one list (`setupGuides`) used by the Connect page, the Help page and `connectors/` (Gemini CLI extension + `GEMINI.md`, ChatGPT guide; generated and checked by a test).

## 2. AI tool and model on documents
Migration `20261030091015_document_ai_tool_model.sql`. `item_documents.ai_tool` / `ai_model` hold the latest AI author; **every version** (`item_document_versions`) keeps its own, so "written with Claude, revised by ChatGPT" is in the history and can be analysed later.
- **Tool**: set by the database from the authenticated connection (not forgeable, not a column anyone can write).
- **Model**: what the assistant says it is (`ai_model` argument of `create_document` / `update_document`, at most 80 characters, plain text). It is advisory, so it is good for comparing models but is not proof. An assistant that rewrites the text without stating a model does **not** inherit the previous author's model; a person's edit, a status change or approval leaves both columns alone.
- Shown on the Spec tab (list, accept-draft note, version list), returned by `list_documents` and `get_document`.
- These are document columns, not the 170 item fields of the field dictionary (nothing in the grid changes).

## 3. Document submission log
Settings, Audit log, **Document submissions** (`/settings/audit/documents`; account admins, and platform admins inside the account) and Platform, Audit log, **Document submissions** (`/platform/audit/documents`, all accounts, filter by account). One row per saved version: when, person (name and email as they were then), project, initiative (code and name), document title, type, Created / Updated (vN), AI tool and model, and **Open**, which goes to `/portfolio?item=R-12&tab=spec&doc=<id>`. Titles and names only, never the text. Database functions `document_submissions(tenant)` (admin of the account or a platform admin with an entry) and `platform_document_submissions(tenant?)` (platform admins only). A platform admin opens a document only after entering its account, which is logged and visible to that account's admins (rule 10).

## 4. Team, not owner
`TEAM_RULE` (both flows): documents start with a **Team** table (Product manager, Designer, Engineering manager and any role the person names). Names come from the person's words (new optional argument `team` of `write_prd` and `write_discovery`, or the chat), never from the signed-in account; the one question message asks "product manager = ?, designer = ?, engineering manager = ?"; unknown reads "to define". Sponsor and Product Manager fields are set only from what was said, for workspace members. The always-on instruction budget went from 11,500 to 12,500 characters for this rule.

## 5. Help
Help, **AI agents**: Use-cases (brainstorm, create, review, update, and what makes the agent better: company profile, project context, prior knowledge, checked research, team, comparable models, safety), then Claude, ChatGPT and Gemini, each with set-up, onboarding, features and commands. A test fails if a flow is missing from it.

## 6. Decisions
- Memory tables and the `recall`/`remember`, `review_group`, `check_research` tools are **not** built (Ashu, 2026-10-30): the company profile and the prompt rules already do this for Claude, and they work for any client.
- Write source stays `Claude MCP` for every assistant. Renaming it to `MCP` plus a client column (request #230 step 2) rewrites audit history and guards; it needs a separate go-ahead. Until then the assistant is told apart by `mcp_connections.assistant` and `item_documents.ai_tool`.

## 7. What is left of request #230
Step 1 (OAuth client registration: loopback redirects for Gemini CLI, a pre-registered client for Gemini Enterprise, ChatGPT redirect URIs `https://chatgpt.com/connector_platform_oauth_redirect` and `https://platform.openai.com/apps-manage/oauth`) and the per-client test runs need the live Supabase OAuth server.

## 8. [SPIKE] S8c, unverified
Nothing here has been tested against a real client: (1) ChatGPT Developer mode connects, completes OAuth and lists the tools; `search`/`fetch` shape is accepted. (2) Gemini CLI completes `/mcp auth`, accepts the simplified schemas, shows prompts as slash commands. (3) Gemini Enterprise accepts a pre-registered client. (4) The registered client names match `detectAssistant`. (5) Effective upload limits per client. (6) Assistants actually send a correct `ai_model`. Record results in `docs/08`.
