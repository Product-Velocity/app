---
date: 2026-11-26
by: Ashu (2026-11-26, chat: the Product space showed only its top-level page; asked for the fix), built by Claude
request: 718
status: built, to confirm
---

# Confluence folders in the page tree (issue #718)

**Problem.** Folders are a separate Confluence content type. `depth=root` returns no folders and hides pages that sit in one; `/pages/{id}/children` returns pages only. A space such as Product, whose pages all sit in folders, showed only its home page.

**Decision.**
- Top-level folders are found from the pages (`parentType: folder`), followed up with `GET /folders/{id}` until the parent is the space. Confluence has no call to list a space's folders (feature request CONFCLOUD-84275), so an empty folder is not found, and a space with many folders costs up to 300 reads (bounded: 20 pages of results, 300 folder reads).
- A folder opens with `/folders/{id}/direct-children`; a page opens with `/pages/{id}/direct-children` (so folders under a page show), falling back to `/children` on 401/403/404/410.
- Folders open but are never chosen: publishing and importing stay page-only. Whiteboards, databases and smart links are left out.
- New scopes `read:folder:confluence` and `read:hierarchical-content:confluence` are requested but **not required** (`CONFLUENCE_OPTIONAL`), so connections made before keep working, without folders, until reconnected. If folders cannot be read, the pages are still listed with a note.
- **Confirmed on a live site (Ashu, 2026-11-26, the Product space):** with both scopes granted, folders and nested folders show and open.

**Parity.** Jira has no folders; this is Confluence-only and is not a tracker sync feature.

**Follow-up (issue #722).** A folder can be chosen as the parent of a new page in the publish dialog (not in the import dialog, which needs a page). The server tries an id that is not a page as a folder (it must exist and be in the chosen space) and sends it as `parentId`. Not yet confirmed that Confluence accepts a folder as `parentId`; if it refuses, the dialog shows Confluence's reason. The connection page lists the two optional permissions as granted or not granted.
