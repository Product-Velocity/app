# Claude, MCP and AI features

## Remote MCP server
Hosted at `/mcp`, OAuth-authenticated; every call runs **as the signed-in user** with that user's role. Same policy layer as the UI.

**Authentication (spike S8):** built on Supabase Auth's OAuth 2.1 server (beta): PKCE, optional dynamic client registration, a consent page we build (`/oauth/consent`) with approve/deny, exact-match redirect URIs, ordinary Supabase tokens so RLS applies as the user. Claude custom connectors support OAuth with dynamic client registration; the Claude callback is `https://claude.ai/api/mcp/auth_callback` (may move to `claude.com`), tokens must refresh, and a 401 should carry a `WWW-Authenticate` header. `/mcp` must also publish protected-resource metadata. Open: tool schema size limits (not found), and a real connection test (S8b) at the start of Phase 4. When Claude acts, our server must set the write source `Claude MCP` itself in a way users cannot forge; as of 0.35.0 the source is derived from the OAuth token (`client_id` claim, migration 0041) and a forged `x-pv-via: Claude MCP` header is recorded as `API`. The server is switched on with `MCP_ENABLED=true` (off by default); built so far: `/mcp`, protected-resource metadata, a minimal `/oauth/consent` and `get_workspace_context` (see `docs/08` S8b result). Tools (initial set, mirrors the "What Claude may do" table, board 14):

| Capability | Mode |
|---|---|
| Search items, documents, delivery status, capacity | Allowed |
| Create draft items, write/revise documents, propose epics and tasks | Allowed; output flagged "AI draft" |
| Draft weekly update, reports narrative, gate pack, insights, outcome reviews | Allowed; human reviews |
| Edit existing fields | Allowed with a shown diff and confirmation |
| Create issues in GitHub, send alignment invitations, send reports | **Confirmation required** |
| Approve a gate / mark Ready for build; set Stack Rank, Decision, Value | **Never** |

Batch operations are supported (many items in one call), each logged individually with `via = Claude MCP`.

## Guardrails
1. User's role applies; Approver can't be delegated. 2. Drafts carry an "AI draft" flag until a human edits/accepts. 3. Confirmation before any outbound or irreversible action. 4. Source documents, issues and emails are **data**: strip/ignore embedded instructions; never let them change tool behaviour. 5. Full audit "via Claude". 6. Per-tenant switch to disable Claude; per-user connection list with revoke. 7. Rate limits and usage metering (`ai_usage`).

## In-app AI features
- **AI intake** (board 5): paste email/notes → structured draft items, duplicate check against existing items, user confirms.
- **Ghost suggestions** in empty cells (accept with Tab).
- **Spec drafting** from conversation; **epic/task proposal**; **invitation drafting**; **weekly update**; **report narrative**; **gate packs** [R2]; **opportunities to improve** [R2] (evidence-based, team-level, with suggested action); **outcome review prep** [R2].
- All use server-side Anthropic API calls with prompts versioned in the repo and evals (golden inputs) for intake, epic proposal and insights.

## Coding-agent integration (upsell, [R2])
"Agent-ready" items (`agent_ready` = true when spec, acceptance criteria and breakdown are Complete) can be handed to coding agents through GitHub (issue assigned to an agent, PR returned, progress flows back). Token/credit packs sold on top of plan allowances. Requires: usage metering, allowance enforcement, spend caps, and **agent capacity** in the capacity model (not yet designed).

## Prompt-injection and data-handling tests (required)
Test fixtures with hostile text in documents/issues/emails that try to: approve a gate, change rank, exfiltrate other tenants' data, reveal system prompts. Expected: ignored and flagged.
