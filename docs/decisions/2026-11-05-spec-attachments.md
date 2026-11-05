---
date: 2026-11-05
by: Ashu, proposed by Claude
request: 325
status: in progress (slice A)
---
**One Spec tab, one list of attachments per initiative (issue #325).** Today there are three systems: written documents (`item_documents`, Spec tab), files/screenshots (`item_files`, Overview) and artifact links (`item_links`, Overview). They become one list of entries of three kinds: written (Markdown with versions and approval), file, link. All add and edit moves to the Spec tab; Overview keeps a read-only summary that opens it.

- **Adding.** One Add control (Write, Upload file, Add link), drag and drop onto the tab, paste an image (becomes a file), paste a URL (becomes a link).
- **Sharing.** Every file and link is shared with GitHub/Jira by default, with a "Do not share" switch per entry. Written documents are never sent (rule 2 and the existing test). Links go out as today; files go out as their share link, in private repositories only (unchanged guard). **Risk, to confirm:** default-on means each uploaded file gets a login-free link. Slice A keeps today's behaviour (a link is created when the file is shared); the switch defaults to on for new uploads.
- **Slices.** A: UI over the existing tables. B: `item_attachments` table, forward-only migration, one dictionary field instead of `artifacts` and `screenshots` (needs the CSV/workbook updated), unified MCP tools, Help "AI agents" tab. C: thumbnails, lightbox, PDF preview, search and filters, more kinds, link title fetch.
- **Parity.** Tracker payloads do not change; GitHub and Jira are served by the same data.
