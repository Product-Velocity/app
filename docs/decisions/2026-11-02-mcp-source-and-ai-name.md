---
date: 2026-11-02
by: Ashu
request: 289
---
The write source `Claude MCP` is renamed **`MCP`** for every AI assistant, and every audit entry from an assistant carries two more columns, **AI name** (`ai_tool`: claude, chatgpt, gemini, other) and **AI model** (`ai_model`). This is step 2 of request #230 ("MCP client neutrality"), which `docs/27-AI-ASSISTANTS.md` had left for a separate go-ahead; Ashu gave it on 2026-11-02 after Claude, ChatGPT and Gemini all connected through the one server.

**What changes.** Migration `20261103004500_mcp_source_and_ai_name.sql` rewrites the old value once, in every `via` / `created_via` / `saved_via` column and in the audit entries that recorded a creation source. All of the pre-existing history was written through Claude, so those entries get AI name `claude` (or the connection's assistant when the connection is known) and no model. Every check constraint, policy and function that tested the literal is re-created from the catalog with `MCP` (Approver, Stack Rank, Decision, Value, admin and GitHub actions, documents, company profile, undo), and the migration fails if any is left. `write_source()` returns `MCP` for a token with a `client_id` claim; a forged `x-pv-via: MCP` (or the old `Claude MCP`) header is recorded as `API`, and the old name is no longer a valid server-set source.

**Audit history.** This is the one time audit history is rewritten. The append-only triggers of `audit_log` are paused inside the migration (and all other triggers on the touched tables, so no new audit rows, timestamps or guards fire), then re-enabled; a test applies the migration over old-style rows and checks the row count is unchanged and the log is append-only afterwards.

**AI name and model.** The AI name comes from the authenticated connection (`mcp_connections.assistant`), so it cannot be forged; a token with no live connection is `other`. The model is what the assistant says it is: every write tool accepts an optional `ai_model` (at most 80 characters), `/mcp` passes it as the header `x-pv-ai-model` and the audit trigger stores it only for `MCP` writes. It is advisory, good for comparing models but not proof. Documents keep their own `ai_tool` / `ai_model` per version (migration `20261030091015`).

**Not changed.** Initiative Groups named "Claude MCP" are user data and stay as they are. The Created Via option text in the field dictionary is unchanged. Internal names such as `is_claude_token()` and the `claude_enabled` switch keep their names; they are not shown to people.

**Re-timed.** The migration was first named `20261102223213_...` and moved to `20261103004500_...` before it was applied anywhere, because Jira migrations merged to `main` meanwhile (`jira_issues`, `jira_pull_in`) still named `'Claude MCP'` and sort between the two. The rewrite has to run after every migration that names the old value; a test (`mcp-source-name.test.ts`) fails if a later migration brings it back.
