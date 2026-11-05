---
date: 2026-11-05
by: Ashu, proposed by Claude
request: 325
status: in progress (slices A and B built)
---
**One Spec tab, one list of attachments per initiative (issue #325).** Today there are three systems: written documents (`item_documents`, Spec tab), files/screenshots (`item_files`, Overview) and artifact links (`item_links`, Overview). They become one list of entries of three kinds: written (Markdown with versions and approval), file, link. All add and edit moves to the Spec tab; Overview keeps a read-only summary that opens it.

- **Adding.** One Add control (Write, Upload file, Add link), drag and drop onto the tab, paste an image (becomes a file), paste a URL (becomes a link).
- **Sharing.** Every file and link is shared with GitHub/Jira by default, with a "Do not share" switch per entry. Written documents are never sent (rule 2 and the existing test). Links go out as today; files go out as their share link, in private repositories only (unchanged guard). **Risk, to confirm:** default-on means each uploaded file gets a login-free link. Slice A keeps today's behaviour (a link is created when the file is shared); the switch defaults to on for new uploads.
- **Slices.** A: UI over the existing tables. B: `item_attachments` table, forward-only migration, one dictionary field instead of `artifacts` and `screenshots` (needs the CSV/workbook updated), unified MCP tools, Help "AI agents" tab. C: thumbnails, lightbox, PDF preview, search and filters, more kinds, link title fetch.
- **Parity.** Tracker payloads do not change; GitHub and Jira are served by the same data.

**Slice B, as built (decisions made while building):**
- **Table.** `item_attachments` (`kind` file or link; `shared`; the share token is made by a database trigger, never taken from the client; kind and stored file cannot change). Migration `20261105165113_item_attachments.sql` copies every `item_links` and `item_files` row with its id and drops the two tables. Files that had a link are shared; files that had none are not shared; every link is shared. Audit rows from before keep the old entity names; the activity feed and undo understand both.
- **Dictionary unchanged.** Screenshots (files) and Artifacts (links) stay two dictionary fields, two views of the one table. That keeps the 170-field dictionary, the grid columns, the tracker field slots and the CSV/workbook exactly as reviewed; collapsing them is only a naming change and can be done later if wanted. (This differs from the slice plan above, which said "one field".)
- **Default sharing.** A file added in the panel is shared (link on). A file added by an assistant is not shared until a person asks (unchanged from before); a link added by an assistant is shared, as before. The tracker push reads only links with `shared` true, and files only when they have a token and the repository is private.
- **MCP.** The tool names and arguments do not change (a rename would break assistants already set up); `get_item` shows `shared: false` on a link that is not shared. Merging add_file and add_link into one tool is left for later, if wanted.
- **Not verified here:** the migration on a database holding real rows from production (only the empty test databases); run it against a copy first.
