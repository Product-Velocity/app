---
bump: minor
---
**Every product email in the branded layout, with a send log (issue #370, phase 2).** Workspace invitations, access requests to admins, access approved, the linked-address code and the alignment invitation, reminder and new-link emails now come from the same template registry and look like the sign-in emails: logo, one button, footer. The wording is unchanged. Each send is recorded in a new send log (template, outcome and delivery state, never an address or text), and delivery events from Resend update it for every template. Adds the migration `email_send_log`.
