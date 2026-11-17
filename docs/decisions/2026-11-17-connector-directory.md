---
date: 2026-11-17
by: Ashu (asked how to list the connector in Claude's Connectors Directory), built by Claude
status: built, to confirm; submission not made
---
**Product Velocity's MCP server is made ready for a submission to Anthropic's Connectors Directory (developer portal, claude.ai/directory/manage, "MCP connector").** The submission itself is a go-live step for Ashu (see `docs/14-GO-LIVE-CHECKLIST.md`). No request issue exists yet; create one before the submission work starts.

**Sources read (2026-11-17):** claude.com/docs/connectors/building/submission, review-criteria and authentication. Anthropic scans a submission automatically and lists it as a **Community** connector by default; a person reviews only if it is escalated to **Verified**.

**Tool audit and what changed in the code**
- Every tool already had a title and annotations, names under 64 characters, no catch-all read/write tool, nothing that moves money or generates media. A test now pins these ("directory rules" in `apps/web/src/lib/mcp/rpc.test.ts`).
- `destructiveHint: true` is now set on every write tool that replaces, removes or publishes something: `set_relations`, `set_file_sharing`, `update_document`, `apply_prd_extract`, `update_company_profile` (joining `update_items`, `confirm_changes`, `remove_link`, `undo_last`, `remove_file`). Only `create_items`, `add_link`, `add_file` and `create_document` stay additive. Effect: Claude asks for confirmation before those five.
- `get_playbook` is listed only to clients that cannot start prompts (ChatGPT and unknown clients). Claude and Gemini get the same flows as prompts. Its description no longer tells the model to follow what it returns; the server instructions still do that for ChatGPT.
- Wording that gave orders ("Call this first", "Tell the person what it says", "Show the diff… only after") now describes behaviour instead.
- An unexpected failure now says whether anything was changed and what to do, without details. A read result over 100,000 characters is refused with advice instead of filling the conversation.
- The OAuth consent screen shows the host the person returns to (the MCP authorization spec asks for it).

**Authentication (read, not tested live).** Our setup matches what Claude needs: `401` with `WWW-Authenticate: Bearer resource_metadata=…`, `resource` equal to `<origin>/mcp`, the authorization server (Supabase `/auth/v1`) on another host (allowed, but it must be reachable from Anthropic's egress range 160.79.104.0/21 and serve RFC 8414 or OpenID discovery), S256 PKCE. To check on the live deployment before submitting (spike S8b): Supabase registers Claude through dynamic client registration (or choose Anthropic-held credentials with redirect `https://claude.ai/api/mcp/auth_callback`), the redirect `https://claude.ai/api/mcp/auth_callback` and Claude Code's loopback `http://localhost:<port>/callback` and `http://127.0.0.1:<port>/callback` are accepted, `/token` accepts form-encoded bodies and answers refresh failures with `invalid_grant`, and discovery, registration and token endpoints answer within 10 seconds. With one URL for all customers (we have one), no Verified label is needed.

**Still needed from Ashu before submitting** (also in the go-live checklist): a public documentation page, a privacy policy (it must say the audit log stores the AI name taken from the connection and the optional `ai_model` a tool call states, and that tool results are read from the person's own workspace), a support contact, an icon, a company name and review contact, and a reviewer account: Creator role in a fully populated "Meridian Media" workspace (initiatives in several phases, documents, a file, a company profile). A read-only role makes every write tool fail. `add_file` takes base64; a reviewer may try it and a large body can be refused by the connection (the tool says so).
