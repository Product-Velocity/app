---
date: 2026-11-02
by: Ashu
request: 67
---
**The Jira connection (issue #67, slice A).** A connection is one Atlassian sign-in (an OAuth 2.0 grant) of a workspace; it lists the Jira sites it reaches. A **project** links to one connection and one Jira project (slice B), so two projects of the same workspace can use two Jira sites, without signing in once per project. Order: A connect, store safely and disconnect; B link a project to a Jira project with the per-project issue types and the field mapping (#70); C read Jira into "new items" in Sync (#71, #76).

- **Tokens** are stored encrypted in the app (AES-256-GCM, key in `ATLASSIAN_TOKEN_KEY`, a previous key may stay in `ATLASSIAN_TOKEN_KEY_OLD` while tokens are re-encrypted), in a table that signed-in users cannot read and that has no audit trigger. Chosen over Supabase Vault: boring, testable and not tied to one plan.
- **Atlassian's refresh token rotates** (spike J4). A refresh claims a short lease so only one runs per connection, stores both new tokens in one write and lets the others re-read them. If Atlassian refuses the grant the connection becomes "sign in again needed" and an admin is asked to sign in again.
- **Only a human admin** connects or disconnects (never a service account, Claude or platform staff). The OAuth state is signed, tied to the person and workspace, and valid ten minutes. Disconnecting deletes the tokens at once.
- The throwaway test page `/spikes/atlassian` stays until slice B and shares the same callback address.
