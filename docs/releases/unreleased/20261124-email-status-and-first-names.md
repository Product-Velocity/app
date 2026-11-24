---
bump: minor
type: new
---
**Pause or activate each email, and a personal greeting on all of them.** In the platform Emails console every email now has a Status: Active or Paused. A paused email is not sent, the personal notes from Ashu start Paused, and the sign-in, confirmation, reset and code emails and the voting emails are always on. This replaces the setting in Vercel. Every email now opens "Hi <first name>," (or "Hi there," when the name is not known), and setting up a workspace asks for your first and last name, filled in for you when you sign in with Google. Adds a table and three functions for the status (migration `20261124170651_email_template_status`).
