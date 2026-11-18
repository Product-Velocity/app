---
date: 2026-11-18
by: Ashu
request: 530
---
**The public pages no longer print the owner's name or email address; they link to a contact form at `/contact`.** Ashu (2026-11-18): remove the name and address, link to the contact form, update the subject dropdown, merge when ready.

- `/contact` (public, in the sitemap and `llms.txt`) has name, email, a subject dropdown and a message. Links can preselect the subject: `/contact?subject=privacy` (privacy policy), `connector` (Connect Claude page); others are `general`, `early-access`, `security`, `partnerships`, `other`.
- It sends one email to the address in `lib/public-contact.ts` (registry key `site.contact`), with the sender as reply-to, and stores nothing. Five messages an hour per address and per visitor; a hidden field turns bots away. The address stays in code as the recipient only and is never rendered; a test fails if a public page prints it.
- Replaced on: `/connector`, `/privacy`, the Help footer, the public page footer and `llms.txt`. The homepage footer and public-page header gain a Contact link.
- **Go-live note:** the Claude connectors directory submission may ask for a support email; give the directory the contact page address (`https://productvelocity.app/contact`) unless it insists on a mailbox, and then use a role address, not a personal one. Also set `RESEND_API_KEY` and `EMAIL_FROM`, or the form cannot send.
