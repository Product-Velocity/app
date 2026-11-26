---
bump: minor
---
**Say what a link holds.** A link on the Spec tab can now carry a document kind (PRD, Business case, Go-to-market and the other kinds of written documents), so you and Claude know where the latest document of each kind lives, for example a Business case you keep in Confluence. Pick the kind when you add the link or change it later from the row; Claude can set it when it adds a link, and `list_documents` and `get_item` show it. The kind stays in Product Velocity and is not sent to GitHub or Jira. Migration `link_doc_kind` adds one optional column.
