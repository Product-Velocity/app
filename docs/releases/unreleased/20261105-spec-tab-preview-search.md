---
bump: minor
---
**Spec tab: previews, search and link titles.** Image files show as thumbnails that open in a large preview (Esc closes, arrows move between images). Search the documents, files and links of an initiative and show only one kind. A link added without a name is named after its page. Three more kinds of document: Design, Customer evidence and Meeting notes (migration `20261105211107_document_more_kinds.sql`). Read-only views named `item_links` and `item_files` stay for now so the older app version keeps working.
