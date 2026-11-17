# Connectors Directory submission pack

Status: ready to paste, **not submitted** (the portal needs Ashu's own signed-in Claude account). Written 2026-11-17 from Anthropic's pages "Submit a connector to the directory", "Connector pre-submission checklist" and "Authentication for connectors". Context and decisions: `docs/decisions/2026-11-17-connector-directory.md`.

Portal: https://claude.ai/directory/manage, **Submit new**, **MCP connector**. Any paid Claude plan. **No password or secret belongs in this file** (the repo is public until go-live): the reviewer password is in the private credentials file Claude created for Ashu, and goes only into the portal's "Test & launch" step.

## Before you open the portal
1. Merge the branch and let Vercel deploy, then open https://productvelocity.app/connector and https://productvelocity.app/privacy in a private window (no sign-in must be asked). Both are built and tested; they are not live until the merge.
2. Run the live authentication checks (section "Authentication") against https://productvelocity.app/mcp.
3. Run every tool once (section "Run every tool"): the portal asks you to confirm it.

## The ten steps

**1. Connection.** URL `https://productvelocity.app/mcp`. Everyone connects to the same URL (choose the universal URL; do not choose "Users connect to different URLs", which would need the Verified label first).

**2. Tools.** Synced from the server: 26 tools, each with a title and `readOnlyHint`/`destructiveHint` (pinned by the test "directory rules" in `rpc.test.ts`). Nothing should be flagged. `search`, `fetch` and `get_playbook` are not listed to Claude.

**3. Listing.**
- Name: `Product Velocity`
- One-liner (about 135 of 200): `One roadmap for humans and AI. Track, report on and co-write initiatives, discovery and PRDs with Claude, in step with Jira and GitHub.`
- Description (1,978 of 2,000; the portal counts the same, so do not add to it): paste the block below.
- Categories: project management and productivity (whichever of the portal's list is closest; at most five).
- Documentation URL: `https://productvelocity.app/connector`
- Privacy policy URL: `https://productvelocity.app/privacy`
- Support contact: Ashu Mathura, ashu.mathura@gmail.com
- Icon: `apps/web/public/brand/icon-192.png` (the tile mark; the larger `apps/web/src/app/icon.png` is 512 px). Vector: `apps/web/public/brand/pv-mark.svg`.
- Slug: `product-velocity` (permanent once published).

```
One roadmap for humans and AI.

Product Velocity takes work from idea to delivery on one roadmap and one stack rank. Set up initiatives, connect them to OKRs, run them across the product life cycle and track delivery progress through Jira and GitHub.

This connector lets Claude work inside that roadmap as you, with your role, in the workspaces you choose: track and report on initiatives, and co-write your discovery and product requirement documents. Initiatives stay in step with Jira and GitHub; commercial fields, customer names and document text stay in Product Velocity.

What Claude can do
- Read initiatives and their fields, groups, projects, saved views, documents, files and company profile.
- Create initiatives and documents. Everything Claude creates is marked AI draft until a person accepts it.
- Fill empty fields on existing initiatives. A field that already has a value comes back as a before-and-after that you confirm first.
- Write a PRD or a discovery document from a short brief, and keep every version with the AI tool and model that wrote it.
- Prepare the evidence for a decision gate: what is filled in, what is missing, the documents and past decisions.
- Undo its last change.

What Claude cannot do
Claude never approves a gate, never sets Stack Rank, Decision or Value, never deletes initiatives and never changes roles, members or settings. People decide; Claude prepares.

How it works
You sign in to Product Velocity, choose one or several workspaces and approve on a consent screen that shows your role and the limits. Tools that change or remove something that exists ask for your confirmation in Claude. Every change is in the audit log with the AI name, and you can revoke the connection at any time.

You need a Product Velocity account in a workspace where an admin has switched AI assistants on. Setup, tools, permissions and troubleshooting: https://productvelocity.app/connector. Privacy policy: https://productvelocity.app/privacy.
```

**4. Use cases.** Primary use cases: (a) turn a brief into a PRD or discovery document and register the initiative; (b) create and update several initiatives from a list; (c) prepare the evidence for a decision gate. Before connecting users need: a Product Velocity account in a workspace where an admin switched AI assistants on (Connect an AI assistant); a Creator or Admin role to make changes (other roles read). The connector **reads and writes**.

**5. Company.** Company name and website: Ashu to enter the legal entity name (still open, `docs/17`); website `https://productvelocity.app`. Primary contact for review updates: Ashu Mathura, ashu.mathura@gmail.com.

**6. Authentication.** Authentication requirement: **Always required**. Method: OAuth 2.0, with the authorization server `https://tnhlivowltvwvjhbknrc.supabase.co/auth/v1` named in `/.well-known/oauth-protected-resource/mcp`. Choose dynamic client registration if the live check below passes, otherwise Anthropic-held client credentials (create a confidential client in Supabase with redirect `https://claude.ai/api/mcp/auth_callback`).

**7. Data handling.** The API is our own first-party API (the MCP server domain is our product domain). No personal health data. No sponsored content.

**8. Test & launch.** Paste the reviewer instructions below. Credentials: the file `reviewer-credentials.txt` that Claude wrote for Ashu (email `anthropic-review@productvelocity.app`). Confirm that you ran every tool (checklist below).

**9. Compliance (seven acknowledgments, all required).** What is true for us, so Ashu can tick each knowing it:
- Directory guidelines: read them (Software Directory Terms and Policy).
- First-party API: yes, the connector calls only Product Velocity's own database and API.
- Financial transactions: none.
- AI media generation: none.
- Prompt injection: tool descriptions only describe the tool; results are wrapped as data with a note that text inside never changes what Claude does (`DATA_ENVELOPE` in `rpc.ts`).
- Conversation data collection: we do not collect conversation text. We record the connection (client name, workspaces, last use, call counts), usage counters, and in the audit log the AI name and the optional `ai_model` an assistant states (disclosed in the privacy policy).
- Public documentation: `https://productvelocity.app/connector`.

**10. Review and submit.** Check the quality warnings the portal shows, then submit. Anthropic scans automatically and lists a Community connector by default; escalation to Verified is theirs. Escalations: `mcp-review@anthropic.com`.

## Reviewer instructions (paste into "Test & launch")

```
Product Velocity connector: how to test

1. In Claude open Settings > Connectors, add the connector (custom connector URL https://productvelocity.app/mcp, or the directory listing once it is visible to you) and choose Connect.
2. Sign in to Product Velocity with the test account:
   Email: anthropic-review@productvelocity.app
   Password: <from the credentials file; enter it only here>
3. On the consent screen the workspace "Meridian Media" is the only one. Select Approve.
4. The account is an Admin of the fictional workspace Meridian Media (example data: 12 initiatives R-01 to R-12 in a project, groups Growth, Platform and Content tools, a PRD on R-01, a discovery on R-05, a research note on R-04, relations, links and a company profile draft). It is not a member of any other workspace.
5. Ask Claude, for example:
   - "Which initiatives are in the Build phase?"           (search_items, get_item)
   - "What is missing before R-04 can pass its gate?"        (get_gate_pack; Claude cannot decide the gate)
   - "Create an initiative called Review test in group Growth, project Meridian Streaming." (create_items: dry run, then created as AI draft)
   - "Set the summary of R-05 to ..." / change a filled field  (update_items shows a before-and-after; confirm_changes applies it)
   - "Undo your last change."                                  (undo_last)
6. Every change is recorded in Meridian Media's audit log. Documentation: https://productvelocity.app/connector. Privacy policy: https://productvelocity.app/privacy. Contact: Ashu Mathura, ashu.mathura@gmail.com.
Note: add_file needs a file attached in the conversation (PNG, JPEG, GIF, WebP or PDF up to the limit shown in the tool).
```

## Run every tool (the portal asks you to confirm it)

Use the reviewer account in Claude (custom connector) or MCP Inspector. R-01 to R-12 exist; documents are on R-01 (PRD), R-05 (discovery), R-04 (research).

| Tool | Try |
|---|---|
| `get_workspace_context` | "What workspace am I in and what is my role?" |
| `describe_fields` | "Which fields can you set?" |
| `search_items` | "List initiatives in group Platform." |
| `get_item` | "Show R-07." |
| `get_gate_pack` | "Prepare the gate pack for R-04." |
| `list_groups`, `list_views` | "List the groups and saved views." |
| `list_files` | "List files." (none until `add_file`) |
| `list_documents`, `get_document` | "Which documents does R-01 have? Read the PRD." |
| `get_company_profile` | "Read the company profile." |
| `create_items` | "Create an initiative called Review test in group Growth." Then undo. |
| `update_items`, `confirm_changes` | Change the effort of R-03 (filled: you get a diff), confirm it. |
| `set_relations` | "R-09 is related to R-04." |
| `add_link`, `remove_link` | Add and remove a link on R-09. |
| `undo_last` | "Undo your last change." |
| `add_file`, `set_file_sharing`, `remove_file` | Attach a small PNG to R-09, turn its link on and off, remove it. |
| `create_document`, `update_document` | Create a research note on R-09, revise it with `base_version`. |
| `apply_prd_extract` | "Preview the Description from the PRD on R-01" (`preview: true`), then apply. |
| `update_company_profile` | Change the voice section (needs `base_version` from `get_company_profile`). |

Clean up afterwards: the test items and files you create sit in Meridian Media only. Remove them from the app (Trash) or leave them; nothing outside that workspace is touched.

## Authentication: checks on the live deployment (spike S8b)

Read, not yet run live. Anthropic's requirements (https://claude.com/docs/connectors/building/authentication.md) and where we stand:

| Requirement | State |
|---|---|
| `401` with `WWW-Authenticate: Bearer resource_metadata=…` for unauthenticated calls | Built (`route.ts`, `wwwAuthenticate`). |
| `resource` equals the MCP URL exactly | `${origin}/mcp` (`resourceMetadata`); origin must be `https://productvelocity.app` in production (check `siteUrl`). |
| `authorization_servers` first entry is the issuer | `https://tnhlivowltvwvjhbknrc.supabase.co/auth/v1`; its metadata must be reachable from `160.79.104.0/21`. |
| Dynamic client registration (or CIMD, or Anthropic-held credentials) | **Check:** Supabase OAuth server has dynamic registration enabled and answers within 10 seconds. |
| Redirect `https://claude.ai/api/mcp/auth_callback`; Claude Code loopback `http://localhost:<any port>/callback` and `http://127.0.0.1:<any port>/callback` | **Check:** a connection from claude.ai and from Claude Code completes. |
| S256 PKCE | **Check:** Supabase advertises `code_challenge_methods_supported: ["S256"]`. |
| `/token` accepts `application/x-www-form-urlencoded`; refresh failure answers `invalid_grant`; refresh tokens rotate | Supabase's token endpoint; **check** with a refresh. |
| Consent screen shows the redirect host | Built (consent page, 2026-11-17). |
