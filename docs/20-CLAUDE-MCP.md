# PRD: Claude as a normal user (remote MCP server)

Status: draft for Ashu's review, 2026-10-27. Extends `docs/05-AI-AND-MCP.md` and the Phase 4 issues #107, #112 and #113 in `docs/06-BUILD-PLAN.md`; nothing here is built. Origin: on 2026-10-27 a Claude session created four initiatives (R-97 to R-100) in a workspace through **direct database access** with an admin tool. It worked, and it showed exactly what a real customer's Claude must be able to do **without** that access.

## 1. Summary
A customer connects Claude (claude.ai, the desktop app or Claude Code) to their Product Velocity workspace as a custom connector. From then on they can say "turn this PRD into four initiatives in the group X, set as many fields as you can, attach these screenshots" and Claude does it **as that user**, with that user's role, through a small set of well-described tools. No service role, no SQL, no knowledge of table names. Everything is audited with source `Claude MCP`. Claude can never approve, rank, decide or value.

## 2. What the database-access session taught us
| What the session had to do | What went wrong or was only possible with admin access | What the MCP must give instead |
|---|---|---|
| Find the workspace, project and existing groups | Listed all tenants and members; guessed from data which workspace was real | The connection is bound to **one workspace** the user chose at consent; `get_workspace_context` returns its projects, groups, teams and members |
| Learn which fields exist and which values are allowed | Read migrations and 50 check constraints by hand | `describe_fields` returns the field registry: key, name, type, allowed values, editable or locked, phase, and whether Claude may set it |
| Create several initiatives with many fields | One bulk insert; one bad value fails the whole statement with a SQL error | `create_items` takes a batch, validates each, returns per-item results in plain language, and creates nothing when asked to dry-run |
| Create an Initiative Group by typing it | Worked because a trigger creates groups | Same behaviour, reported back ("group created") |
| Put a long Markdown story in Description | Worked | Same, with the 20,000-character limit stated in the schema |
| Set Stack Rank, Decision, Value | Blocked only by a trigger when the write source was set | Not offered as inputs at all; server rejects them even if sent |
| Set the write source and actor | Set a session variable by hand; the actor was empty in the audit log | The **server** sets source `Claude MCP` and the signed-in user as actor; a client cannot forge them |
| Fix mistakes (missing G2M date, link in the wrong place) | Edited rows directly | `update_items` with a shown diff and one-step undo |
| Link related work | Used free text "depends on slice 1" because the relation table was not known | `set_relations` (Depends On, Related To) by initiative code |
| Attach images with a share link | **Impossible**: file bytes can only be written by the app server | `add_file` (upload) and `set_file_sharing`, with the public-repository warning |
| Push to GitHub | Left to the user in the UI | `preview_github_push` then `confirm_github_push`; Claude cannot skip the preview |
| Know what happened after the push | Asked the user | `get_github_status` (issue number, labels, type, milestone, what the preview skipped and why) |
| Notice the Type mismatch, empty Milestone, public repo hiding share links | Only after the user looked at GitHub | The preview lists these **before** the push |

## 3. Goals
1. A non-technical customer can connect Claude in under 5 minutes and revoke it in 1 click.
2. The replay scenario in section 8 works end to end as a creator-role user using only MCP tools.
3. Claude's power is exactly the user's power, minus the things Claude may never do.
4. Every write is audited and undoable.
5. Hostile text in documents, issues and emails never changes what Claude does.

## 4. Non-goals (first release)
- A coding-agent hand-off (`docs/05` "Coding-agent integration").
- Claude creating epics and tasks in GitHub (Phase 4 proposal editor, #110).
- Claude editing saved views, scopes, members, roles, billing or security settings.
- Streaming or subscriptions to workspace changes.
- GitLab or Jira writes.

## 5. Principles and guardrails (from CLAUDE.md, restated for this feature)
1. **Acts as the signed-in user.** Role and row-level security apply. Viewer, commenter and leadership roles get read tools only.
2. **Claude never approves.** No tool sets Approver, marks Ready for build, or sets Stack Rank, Decision or Value (Value includes confidence and customer fields). These are absent from the tool schemas **and** rejected server-side (defence in depth). Rank changes only through the human UI.
3. **Commercial fields never reach GitHub**, whatever Claude asks. The existing allowlist test covers the MCP path too.
4. **Documents are data.** Text read through any tool is returned inside a clearly marked data envelope and never treated as instructions. Hostile fixtures are part of the tests.
5. **Confirmation for outbound and irreversible actions:** GitHub writes, invitations, reports, deletes, and changing an existing item's fields (shown as a diff first).
6. **Drafts are flagged.** Items Claude creates carry `ai_draft = true` until a human edits or accepts them.
7. **Audit everything** with actor, source `Claude MCP`, time, old and new value, plus the connection id.
8. **Privacy:** tools never return voter identities or participant answers; alignment results keep the anonymity rules.
9. **Tenant isolation:** a connection is bound to one workspace; all calls are tenant-scoped and tested with two tenants.

## 6. Functional requirements

### FR-1 Connect and manage
- `/mcp` on the app domain, OAuth 2.1 through Supabase Auth's OAuth server (spike S8b first, see `docs/08`), publishing protected-resource metadata; 401 carries `WWW-Authenticate`.
- Consent page `/oauth/consent`: names the client, the workspace, the role Claude will have and what Claude can and cannot do; approve or deny. The user chooses the workspace when they belong to several.
- **Connect Claude** page (account menu): the connector URL to copy, step-by-step setup for claude.ai and Claude Code, the list of this person's connections (client, workspace, created, last used, calls) and **Revoke**. Revoking takes effect on the next call.
- Workspace admins can switch Claude off for the whole workspace and see all connections (names, not content).
- The write source `Claude MCP` is set by the server from the authenticated connection. The advisory `x-pv-via` header is ignored.
- Rate limits per connection and per workspace; usage recorded in `ai_usage` (calls, items written, bytes uploaded). Friendly error when a limit is reached.

### FR-2 Discovery
- `get_workspace_context`: workspace name, the caller's role and what Claude may do for that role, projects (id, name, default repo, tracker), Initiative Groups, teams, members (name, id; no emails unless the caller can see them), cycles, GitHub connection state per project (connected, repo private or public).
- `describe_fields`: the field registry from `docs/reference/item-fields.csv`: key, label, type, allowed values, limits, editable by this caller, `claude_may_set` (false for the forbidden list), phase shipped or not, whether it can reach GitHub.
- Dates follow the user's date format; tools accept ISO dates.

### FR-3 Read and search
- `search_items` (text, filters on any field, group, project, status, phase; paging; field selection), `get_item` (all visible fields, links, files with sharing state, relations, GitHub link state, recent activity), `list_groups`, `list_views` (read only).
- Results are scoped to what the caller's role can read; customer-safe rules unchanged.

### FR-4 Create and change initiatives
- `create_items` (batch up to 50): name required; any field Claude may set; `home_project` by name or id; `group` by name (created when new, spelled like an existing one when only case differs); Description as Markdown up to 20,000 characters; people by name or email resolved to members; per-item result `{created, code, id, warnings[]}` or a readable error that names the field and the allowed values. `dry_run: true` validates and returns the preview without writing. Rank is assigned by the system at the end of the list.
- Items are flagged **AI draft**. The result says so.
- `update_items` (batch up to 50): returns a **diff** for confirmation; writes only after the caller confirms in the same conversation turn by calling `confirm_changes` with the diff id (diffs expire after 10 minutes).
- `set_relations` (Depends On, Related To by code; no self reference), `add_link` and `remove_link` (Artifacts: label plus http(s) URL; private pages are allowed but flagged "needs login" in the result when known).
- `delete_item` is **not** offered. `undo_last` reverses the last Claude change set by this connection using the audit log.
- Validation by stage as in the UI: required-by-stage fields are reported as warnings, never as blockers at creation.

### FR-5 Files and images
- `add_file`: PNG, JPEG, GIF, WebP or PDF, 10 MB, 20 per initiative, type taken from the first bytes (existing `sniffFileType`); bytes sent as base64 or through a short-lived upload URL, whichever Claude clients support (decided in the S8b spike).
- `set_file_sharing`: on or off per file. Turning on returns the share link `/f/<token>/<name>`. The result **states plainly** that for a **public** repository the link will not be written to the GitHub issue, and that anyone with the link can open the file.
- `list_files`. Removing a file is a confirmed action.
- Claude may take screenshots of its own artifacts or pages and upload them; it never fetches arbitrary URLs on the server's behalf.

### FR-6 GitHub
- `preview_github_push` (read-only): exactly what the "Update GitHub" preview shows: title, body sections, labels, issue type match (and **why there is none**), milestone (and why none, for example "G2M Date (est) is empty"), Files section (and why it is skipped for a public repo), fields skipped by the allowlist.
- `confirm_github_push`: requires the preview id and an explicit user confirmation step in the client; cannot be called without a fresh preview. It creates or updates the tracking issue; labels in the `pv:` namespace stay in step.
- `get_github_status`: issue number and link, state, labels, type, milestone, last sync, Project board membership when the connection can read it.
- Claude never creates issues directly in GitHub through PV; it always goes through the push.

### FR-7 Safety
- All text returned from items, documents, issues, emails and files is wrapped as data. Tool descriptions say so.
- Prompt-injection fixtures (hostile Description, issue title, file name, link label) try to approve a gate, change rank, read another tenant, reveal the system prompt, or call `confirm_github_push`. Expected: ignored and flagged in the result.
- Error messages never leak SQL, table names, other tenants or secrets.
- Per-user daily write cap and a per-call item cap; large batches say how many were skipped.

### FR-8 Audit and trust
- Every write records actor (the user), source `Claude MCP`, connection id, tool name, old and new value. The item's Activity tab shows "via Claude".
- A **Claude activity** list for admins: which connection changed how many items, with a link to the audit entries.

### FR-9 Docs and guidance
- `docs/05` updated; a customer-facing guide "Connect Claude to Product Velocity" with three worked prompts: PRD to initiatives, intake from pasted notes, weekly update draft (the last two only if their tools exist).
- Tool descriptions carry examples and the rules above so Claude does not need extra instructions.

## 7. Tool catalogue
| Tool | Mode | Roles |
|---|---|---|
| `get_workspace_context`, `describe_fields` | read | all |
| `search_items`, `get_item`, `list_groups`, `list_views`, `list_files`, `get_github_status` | read | all |
| `create_items` (+ dry run) | write, flagged AI draft | creator, admin |
| `set_relations`, `add_link`, `add_file`, `set_file_sharing` | write | creator, admin |
| `update_items` then `confirm_changes` | write after diff and confirmation | creator, admin |
| `undo_last` | write | creator, admin |
| `preview_github_push` | read | creator, admin |
| `confirm_github_push` | outbound; explicit confirmation | creator, admin |
| Approve, Ready for build, Stack Rank, Decision, Value, Approver, roles, members, delete | **not offered** | nobody |

## 8. The scenario this must pass (end-to-end test)
As a signed-in **creator** (not admin, no database access) in a workspace with one project and a private repository:
1. Connect Claude from the Connect Claude page; approve on the consent screen.
2. Say: "Here is a PRD. Create four initiatives in the group 'Roadmap views', set as many fields as you can, put the story and acceptance criteria in Description, link them in order, attach these three screenshots with sharing on."
3. Claude calls `get_workspace_context` and `describe_fields`, runs `create_items` as a dry run, then for real: four items, one new group, relations set, fields filled, **no** Rank, Decision or Value, all flagged AI draft, source `Claude MCP`.
4. Claude uploads the images and turns sharing on; the share links open without login.
5. Claude runs `preview_github_push`; the preview shows Type, Milestone and Files correctly or explains why not. The user confirms; `confirm_github_push` creates four issues; `get_github_status` shows their numbers.
6. The user revokes the connection; the next call fails with a clear message.
Negative checks in the same suite: a viewer-role connection cannot write; a request to set Stack Rank, Decision or Value, or to approve, is refused; a forged `x-pv-via` header changes nothing; a second workspace's data is unreachable; hostile text in a Description does not trigger any tool.

## 9. Success measures (workspace level only, never per person)
- Share of new initiatives created through Claude that are edited by a human within 7 days (draft quality).
- Share of Claude-created items that pass "ready for stage" checks without edits.
- Connections created and still active after 30 days.
- Preview-to-confirm rate for GitHub pushes and the share of previews with unresolved warnings.

## 10. Decisions already taken and open questions
Taken (2026-10-27 chat, applied from earlier decisions): admins-only workspace-level settings; Claude acts with the user's role; drafts are flagged; GitHub writes need confirmation; share links never go into public-repo issues.

Open (Ashu to decide):
1. **Phase order.** `docs/06` puts the MCP in Phase 4. CLAUDE.md says do not start a later phase early. Pull only **S8b (the connection spike)** forward, or the whole MCP? Recommendation: S8b now, the rest in Phase 4.
2. **Can Claude set the planned dates and effort estimates?** The scenario assumes yes (they are not Value or Decision). Estimates are marked basis "Rough guess" and flagged AI draft.
3. **Should `update_items` always need a confirmation,** or only for fields a human already filled? Recommendation: always for a human-filled field; free for empty fields.
4. **Image upload size and path** is decided in S8b (base64 limits differ by client).
5. **Per-workspace and per-user limits** (items per day, bytes per day) need numbers; start conservative (200 items, 100 MB) and watch.
6. **Default state of the switch** for new workspaces: on or off? Recommendation: off until an admin turns it on (CLAUDE.md rule 3, privacy).

## 11. Work slices (issues in PV, group "Claude MCP")
1. **[MCP 1/7]** Spike S8b: minimal `/mcp`, OAuth connection from Claude, one read tool (`get_workspace_context`).
2. **[MCP 2/7]** Connection management and trust: consent page, Connect Claude page, revoke, workspace switch, server-set write source, rate limits and `ai_usage`.
3. **[MCP 3/7]** Discovery and read tools.
4. **[MCP 4/7]** Create and change initiatives (batch, AI draft, relations, links, diff and confirm, undo).
5. **[MCP 5/7]** Files and images with share links.
6. **[MCP 6/7]** GitHub preview, confirmed push and status.
7. **[MCP 7/7]** End-to-end scenario test, hostile-text fixtures and the customer guide.
