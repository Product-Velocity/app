---
bump: patch
---
**Old file and link views removed.** The two read-only views `item_links` and `item_files`, kept so the previous version kept working during the change to one attachments table, are dropped (migration `drop_item_links_files_views`). Nothing is stored in them.
