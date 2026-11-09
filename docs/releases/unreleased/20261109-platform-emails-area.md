---
bump: minor
---
**Platform Emails area (issue #370, phase 3).** Platform admins get an Emails tab: which event sends which email, to whom, by which code path, whether a person confirms first, the limits, and how many were sent and failed in the last 30 days. Each email opens a preview with sample data at desktop and phone width, as HTML and plain text; a preview never sends. Read-only for now. Adds the migration `platform_email_stats`.
