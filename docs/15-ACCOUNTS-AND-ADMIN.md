# Accounts, workspace settings and platform staff

Status: design agreed with Ashu 2026-10-23 (requests R-014 to R-016). Spec for issues listed in section 8.

## 1. Words
- **Account**: one person's login (email or Google/GitHub). One account can belong to several workspaces.
- **Workspace**: the organisation (the tenant), for example "Meridian Media". All data is isolated here.
- **Platform staff**: people at Product Velocity. They are not members of any workspace; they have a separate, explicit staff level (section 5).

## 2. Flows
1. **New customer:** sign up (email, Google or GitHub) → confirm email → onboarding: name the workspace, set country, currency, time zone and authorized email domains → become its admin → invite people. **Colleague at an authorized domain:** sign up → confirm email → "Requested Access" holding screen → an admin approves in Members (section 3.3).
2. **Invited person:** admin enters email, role and Approver flag → the app sends an invitation email **after the admin confirms** (the link can also be copied) → the person signs up or signs in with that email, accepts, and appears in Members. Links are single use and expire after 7 days.
3. **Several workspaces:** a switcher in the header; the last one used opens first.
4. **Leaving:** a member can leave a workspace unless they are its last admin. An admin can remove a member. A workspace can never lose its last admin.
5. **Deleting an account:** allowed only after leaving or handing over every workspace where the person is the last admin. Personal data is deleted; audit entries keep a non-identifying "former member" label.

## 3. Account page (the person)
Profile (name, photo, language, time zone, date format) · email (change with confirmation) · password (change, strength rules) · sign-in methods (Google, GitHub) · two-factor (already built) · active sessions with "sign out everywhere" · notification preferences (placeholder until notifications are designed) · my workspaces (leave) · **download my data** and **delete my account** · accepted terms and privacy version.

### 3.1 Built so far (release 0.18.0, issue #44 part 1)
Profile (stored with the sign-in account as user metadata: name, language, time zone, date format; so far shown only to the person themselves), email and password change with re-authentication, sign-in methods (link and unlink Google and GitHub; needs "manual linking" switched on in the Supabase Auth settings), "sign out other devices" and "sign out everywhere", my workspaces with switch and leave (policy `tenant_members_leave`; the last-admin trigger blocks the only admin), notification placeholder. **Limits:** the sign-in provider offers no list of devices, so sessions cannot be listed; the name is not yet shown to other members (a profile table with its own privacy rules comes with it). **Next (part 2):** photo, download my data, delete my account, accepted terms and privacy version.

### 3.2 Invitation emails (built in 0.19.0, issue #45)
Members > Invite someone has two steps: fill in, then a **review** (recipient, workspace, role, Approver, the link rules). Nothing is sent before the admin confirms: **Send invitation email** or **Create link only** (the link is always shown once to copy). The email names the workspace, who invited, the role and a single-use link valid 7 days; plain text and simple HTML, no images or tracking. Pending invitations show the email state (Link only, Emailed, Delivered, Bounced, Marked as spam, Not sent with a reason) and have **Resend email** and **New link**: both give a new token and 7 more days, and the old link stops working at once. Limits: 60 seconds between sends to the same person, 5 emails per invitation, 100 invitation emails per workspace per day. An address that is already a member gets no invitation. Provider: Resend over its REST API; the key lives only in environment variables; recipient addresses and bodies are never logged. Bounces and delivery arrive through the optional Resend webhook (`/api/resend/webhook`, signature verified).

### 3.3 Workspace onboarding, authorized domains and the Members grid (built in 0.45.0, issue #216)
- **First user.** Whoever creates a workspace is its Account Admin (`create_tenant`). Onboarding asks for the organization name, country, currency, time zone and **authorized email domains** (prefilled from the admin's work address; a personal address may start with none). The same fields are edited later under **Workspace settings** (`/settings/workspace`, admins only, audited).
- **Authorized domains.** Lower-case domain names, at most 20, free-mail providers refused (`FREE_MAIL_DOMAINS`, repeated in a trigger). Domains are **not verified by DNS** yet: only list domains you own; two workspaces may list the same one. See `14` for the go-live item.
- **Domain-gated sign-up.** After sign-in, a person without a workspace whose **confirmed** email is at an authorized domain gets a `Requested Access` row (role Viewer, no access) through `request_access_by_domain()`, and is sent to `/access-requested`: "We requested your organization admin to review your request…". Paused and revoked people see a plain message there; "Create my own workspace instead" stays available. Each new request emails the workspace's active admins (Resend; skipped when email is not configured) and shows a banner with a count until it is handled.
- **Statuses.** `requested`, `active`, `paused`, `revoked` on `tenant_members.status`; **Invited** is a pending invitation. Only `active` rows grant access anywhere (RLS helpers, directory, and every SECURITY DEFINER function). Non-active people cannot read their own row; `my_access_requests()` tells them where they stand. Status changes only through `set_member_status(ids, status)`: admins, per-row result and reason, audited, never your own row or a service account, and the last active admin cannot be paused, revoked or demoted. Moves: requested to active or revoked; active to paused or revoked; paused to active or revoked; revoked to active. An invitation can only be cancelled; accepting it makes the person Active.
- **The grid** (`/settings/members`). One table for every state with member name and email, Role (all five roles), Approver, Status, Create Date, Last Login, GitHub username; filter chips with counts, search, inline edits that save as you change them (the old value returns if the save is refused), checkboxes and a batch bar offering only the status changes the selected rows share, **Create new invite** (the existing two-step invitation review), Resend and Cancel on invitations. Becoming Active from Requested Access emails the person a confirmation with a link to the platform; a failed email never undoes the approval. Non-admins see the active people read-only.

### 3.4 Account switcher, several accounts and linked emails (built in 0.46.0, issue #219, R-111)
- **Words.** In the product a customer organisation is still a *workspace* (the tenant); R-111 calls it an *account*. A **person** is one sign-in identity (`auth.users`); a **membership** is that person in one workspace (`tenant_members`: role, Approver, status, create date, **last login per membership**). Roles and statuses are per workspace; revoking one membership never touches another. The PRD's "users + memberships split" therefore needed no new table: the model already was that (see `docs/DECISIONS.md`).
- **Switcher.** The first breadcrumb segment is a dropdown with search, a **Recent** section (the accounts opened most recently, from the per-membership last login, so it follows the person across devices) and, for platform admins, a link to the console. A person with one account sees the name only. The account is in the address: `/w/{account}/{page}` (for example `/w/…/gantt`); the proxy removes the prefix and passes the account on, so every page keeps its route and switching keeps the tab. An address naming an account the person cannot open is "not found" for everybody (no names, no counts). Without an address or cookie the person lands in the account they used last. (`/a/` is taken by alignment ballot links, hence `/w/`.)
- **Linked emails** (Account page). Add an address, receive a 6-digit code (15 minutes, five tries, 60 seconds between codes, five per hour; only a hash is stored) and enter it. A verified address belongs to **one person**; asking for an address someone else has gets the same answer as any other, and nothing is sent. Verified addresses: sign in with any of them (password sign-in resolves them server-side to the person's sign-in address), accept invitations sent to any of them, and count for **domain matching** (a workspace whose authorized domains include the address gets a Requested Access row that remembers the address; its admins are emailed). The person chooses the **notification address**. Removing a linked address sends memberships that came *only* through it back to **Requested Access** (the admin's review queue); invitation-based memberships stay. Not built: merging two existing accounts that own the same address (support does it by hand), and sign-in by magic link on a linked address.
- **Workspace setting "Restrict invites to authorized domains"** (default off): when on, invitations to addresses outside the authorized domains are refused (`PV012`). Off, anyone can be invited, which is how a consultant joins several companies.
- **Audit log** (`/settings/audit`, admins; export as CSV, up to 5,000 rows with the same filters). Every entry carries the actor's **name and email and role as they were at the time** (a snapshot taken by the database, so a later name change does not rewrite history), the project, the screen it came from, a batch id for batch actions (one entry per member affected, for example approving four people), how it was made (UI, API, Claude, GitHub webhook, import, system) and, for platform admins, a **Platform admin** badge. Entries from before 0.46.0 have no name or email and say so. Last login is not logged (it changes on every visit).

## 4. Workspace settings (the admin)
General (name, logo, default language and time zone, default planning-cycle and working-week settings) · **Members and invitations** (exists; add resend, role presets, bulk invite) · **Security** (require 2FA for everyone, allowed sign-in methods; SAML in Phase 9) · **Data** (retention for alignment participants, export workspace, delete workspace with a typed confirmation and a waiting period) · **Plan and billing** (plan, billable members, AI allowance; board 27) · **Integrations** (GitHub connection, later GitLab and Claude, see `04` and `05`) · **Staff access log** (section 5.5: every time Product Velocity staff opened or acted in this workspace, visible to its admins).

**Claude (built in 0.36.0, issue #180).** Workspace settings also hold the **Claude switch** (off by default) and the connection list on the Connect Claude page (`/settings/claude`). Admins see who connected, with which client, when it was last used and how many calls, never what Claude read or wrote; they may revoke any connection. Every change is in the audit log (the switch as a change of `tenants.claude_enabled`, connect and revoke as `mcp_connections` rows). Details: `docs/05`.

## 5. Platform staff and super-admin levels
### 5.1 Principle
Early stage (now): Product Velocity staff are **super users** who can see and impersonate any workspace and see its data, to improve the product (decision by Ashu, R-014). The design is **capability-based from day one** so that later, as the team grows, staff accounts can exist that have **no access to customer roadmaps**, with content access only through a customer-approved grant. Switching must be a setting and a role change, not a rewrite.

### 5.2 Levels (presets of capabilities)
| Level | Intended for | Capabilities |
|---|---|---|
| **Super-admin** | Founders | Everything: manage staff and levels, settings, billing, content access, impersonation |
| **Operator** | Ops and customer success | Console, plans, suspend, usage, support actions. Content and impersonation only if the capability is switched on for that person |
| **Support** | Support agents | Account and usage metadata. Content only through a customer access grant |

Capabilities stored per staff member: `can_view_content`, `can_impersonate`, `can_manage_billing`, `can_manage_staff`. Today every staff member is created with all of them on. Levels are only presets; the checks always look at the capabilities.

### 5.3 Platform setting `content_access_mode`
- `open` (**now**): a staff member with `can_view_content` may open any workspace's data.
- `grant_required` (**later**): even with the capability, content access needs an active **access grant** from that workspace's admin (time-boxed, with scope and reason). Staff without the capability never get content, grant or not.
Changing the mode is a super-admin action, logged. The grant mechanism is built before the first staff member without content access is hired (issue in section 8).

### 5.4 How it is built (so tenant isolation stays intact)
- Staff are **not** rows in `tenant_members`. A separate non-tenant schema holds `platform_staff`, `platform_settings`, `platform_access_log` and later `access_grants`. These tables are not exposed through the public API; they are reached only through `security definer` functions that check the caller's capabilities and write the log.
- **Never loosen the normal tenant RLS for staff.** Content access goes through one explicit, narrow path (a function or policy that checks `can_view_content` and the mode) that is covered by two-tenant tests: a staff member without the capability, and a normal member of another workspace, must both be denied.
- Every staff access is written to `platform_access_log` (who, which workspace, what, reason, start, end, read-only or write). Every write made while impersonating appears in the workspace's normal audit log with source `staff`, the staff member **and** the user being impersonated.
- Staff accounts require 2FA. Only a super-admin can create staff or change levels; the last super-admin cannot be removed or downgraded.

### 5.5 Impersonation rules
- A reason is required; the session lasts 60 minutes and then ends.
- A banner is always visible: "You are viewing as <name>, Product Velocity staff".
- **Read-only by default.** Write mode is an explicit switch with its own reason (allowed today for super-admins).
- While impersonating, these are **blocked**: approval-class actions (Approver actions, gate decisions, Ready for build), changing roles or billing, anything that sends (invitations, GitHub writes, report distribution), reading secrets (GitHub keys, tokens, password hashes). Claude's rule "Claude never approves" is unchanged.
- **Transparency:** workspace admins can see the staff access log of their own workspace (settings, section 4), even in `open` mode.
- Alignment voters stay anonymous: staff see voter identities only when impersonating an admin who could see them.

### 5.6 Admin console (internal area, separate route group, staff only)
- **Workspaces:** name, plan, billable members, last active, AI usage, status, GitHub connected yes/no.
- **Workspace detail:** members, plan and seats, usage, staff access log, actions: change plan (manual until Stripe in Phase 9), extend trial, suspend and reactivate, **View as** (impersonate) a member, open workspace data (when allowed).
- **Staff:** list, create, level and capabilities, deactivate.
- **Platform settings:** `content_access_mode`, default plans.
- **Access log:** all staff access across workspaces, filterable.

### 5b. Platform admin access (built in 0.46.0, issue #219, R-111)
What is built is a smaller, simpler version of sections 5.1 to 5.6, and it follows the issue where the two differ (Ashu, 2026-10-28):
- **Who.** `platform.admins` (a flag per person, in a schema that is not exposed through the API). A platform admin is **not** a member of any workspace and never appears in the Members grid. The first one is created with the service role (SQL, see `14`); after that an admin adds others on **Platform > Access settings**.
- **How access works.** Access is by **entry**, never blanket: the admin picks an account in the **All accounts** console (name, plan, owner, members, projects, last activity, search) and *enters* it. An entry is a row in `platform.entries` (8 hours, one open at a time, optional reason); the same access helpers that RLS uses for members (`is_tenant_member`, `my_tenant_ids`, …) also honour an open entry, so row-level security stays keyed on the account id and there is no service-role bypass. Without an entry a platform admin sees nothing of any account. Entering and leaving are written to **that account's audit log**, visible to its admins. Writing mode needs a sign-in within the last 15 minutes (re-authentication; two-factor still applies if the admin enrolled).
- **Banner.** While inside, every page shows "Viewing as platform admin – {name} ({email}) – {account}" and the access level, with a Leave button.
- **Level (FR-2.5).** **Read & write** is the default. It can be set platform-wide, overridden **per admin**, and an account can additionally be **restricted to read-only** for everybody (an account override can only restrict). The effective level is recomputed on every statement, so a change applies at once to open entries. In **read-only** mode the UI disables edit controls and the server refuses every write to a tenant table (error `PV021`, a trigger on all of them, with a test that fails if a new table lacks it). Every change of the configuration is written to `platform.config_log` (shown under Access settings) and, for an account, to that account's audit log.
- **Still blocked for platform admins** (CLAUDE.md rules 3 and 10, unchanged): they never hold **Approver** and cannot approve; they cannot add, remove or change **members, roles, statuses or invitations** (`PV022`); they cannot send (invitation or alignment emails, GitHub writes) or reach integration secrets. Customers see the platform admin's name and email in their audit log (FR-2.9: yes).
- **Not built yet** (still as designed in 5.2, 5.3, 5.5, 5.6): staff levels and capabilities, `content_access_mode` and customer access grants, "View as" a member, suspend and plan changes beyond a label, 2FA required for platform admins (it applies only if enrolled), the staff access log as a separate page (the account audit log shows the entries).

## 6. Legal and trust (go-live items, see `14`)
Open content access is a processor-access question. Before real customers: say so plainly in the terms and the privacy policy (who at Product Velocity can access customer data, why, and that every access is logged and visible to the customer admin); list it for enterprise security reviews; plan the switch to `grant_required` with the first staff member who should not see content.

## 7. Open points
- **Invitation email provider** (for example Resend on its free tier, or custom SMTP through Supabase). Ask Ashu before adding the dependency; needs the sending domain from `14`.
- Account deletion when the person is the only admin of a workspace with other members: block with a clear message (proposal above).
- Export format for "download my data" and "export workspace" (proposal: JSON plus CSV).
- Enforcing plan and seat limits: tracked from day one, enforced after the pilot.

## 8. Issues (order: foundation first)
Foundation (phase 1 follow-ups): account page; invitation emails; platform staff foundation (tables, levels, capabilities, access log, MFA, tests). Before the pilot: workspace settings; admin console; staff content access and impersonation with the staff access log. Later (before the first no-content staff member): access grants and `grant_required` mode. Numbers are in `docs/REQUESTS.md`.
