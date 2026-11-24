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

Slice 3 (Ashu, 2026-11-23): the owner wizard grows to four steps: Workspace, About you, Team, Connect. Team reuses the Members invite form, so each invitation is reviewed and confirmed before anything is sent (rule 3). Continue or Skip on Team finishes setup (and sends the owner email); Connect offers GitHub, Jira and Claude as equals with Help and Contact below. Also fixed: the Get started card's connect link pointed at a screen that does not exist; it now links to GitHub and Jira.

Still later: a welcome screen before the workspace step, follow-up emails (not connected after 2 days, first-week digest), step-completion metrics (team-level only).

Slice 4 (Ashu, 2026-11-23): personal emails from Ashu. There is no welcome email today (only the confirm-your-email message from the sign-up flow and, now, the internal notice to Ashu). Added two plain-text notes sent as "Ashu from Product Velocity", replies to the contact address: a welcome when the creator finishes the Team step, and one follow-up two days after creation if the workspace still has no initiatives and no GitHub or Jira connection (workspaces 2 to 14 days old only, at most 20 a day, once per workspace; runs inside the existing daily GitHub cron because the free Vercel plan allows two cron jobs). Both start Paused (since slice 6 the switch is the Status column in the platform Emails console, not a deployment setting); Ashu is to send the final wording, which is edited in the platform Emails console. Not built: a welcome for invited people, an approval queue before sending, a "stop" list (a "stop" reply is handled by hand; each workspace gets at most one of each email).

Slice 5 (Ashu, 2026-11-24): "Build the tracking next." Email open counts for the invitation and the two personal notes (own 1x1 image, a random id only, never in alignment or auth emails), a platform Usage page of team counts from the audit log, and the privacy page text. Decision and details: `docs/decisions/2026-11-23-email-open-and-usage-tracking.md`. Needs Ashu's OK of the privacy wording before merge.

Slice 6 (Ashu, 2026-11-24): (1) an Active or Paused status per email in the platform Emails console replaces the `FOUNDER_EMAILS` setting in Vercel; a paused email is not sent, the personal notes start Paused, and sign-in, confirmation, reset and code emails and the alignment mailings cannot be paused (they would lock people out or break a mailing an admin confirmed); every switch is in the platform audit log. (2) Every email now starts "Hi <first name>," (new macro `firstname`, fallback "there"). (3) The About you step asks first name and last name separately (first name required unless the step is skipped), prefilled from Google or GitHub when known. Migration `20261124170651_email_template_status.sql`. Decision `docs/decisions/2026-11-24-email-status-and-greeting.md`.

Answer to a question from the same day: a person who signs up with Google gets no confirmation email, because Google has already confirmed the address (Supabase sends the confirm-your-email message only for email-and-password sign-ups).
