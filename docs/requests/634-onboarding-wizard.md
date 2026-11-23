---
issue: 634
status: in progress
logged: 2026-11-23
title: New-user onboarding wizard (clearer, nicer) and owner email when setup is finished
---
Ashu: email me when a new user signs up and finishes the account setup; make onboarding clearer and nicer visually. Proposed flow: sign in, welcome, workspace details, about you, invite team, first item, connect GitHub/Jira, connect Claude, help and contact form. Answers (2026-11-23): build it step by step; no sample workspace; the owner email moves to the end of the wizard.

Slice 1 (this PR): progress bar over Workspace / About you; regional settings tucked under a disclosure; About you step (name, role, first goal, stored in the person's own profile, all optional); "Get started" card on the roadmap for admins (first initiative, invite team, connect GitHub or Jira, with links to connect Claude, Help and Contact; dismissable); owner email `app.new-workspace` sent when the wizard is finished or skipped, once per workspace.

Later slices: welcome screen, invite-your-team and connect steps inside the wizard, path for invited members, follow-up emails, step-completion metrics (team-level only).

Slice 2 (Ashu, 2026-11-23): the flow for invited people. The invitation page now shows what happens next (sign in or create, accept, a one-minute welcome) beside the brand message; accepting sends the person to `/onboarding/welcome` (workspace, role, the one-line value proposition, first things to try by role, optional name and role) and then the roadmap. The invitation email carries the same one-line value proposition and mentions the welcome. The owner email never fires for invited people, even invited admins (flow field plus a member count of one).
