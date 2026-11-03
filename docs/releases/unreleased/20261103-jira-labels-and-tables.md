---
bump: minor
---
**Jira issues get the same labels as GitHub issues, and tables in descriptions arrive as real tables.** Sync with Jira now puts `pv:project/…`, `pv:moscow/…`, `pv:rank/…` (a band: top 10, top 25, top 50 or later, never the number), `pv:type/…` (Change Type) and `pv:group/…` (Initiative Group) on the issue next to `product-velocity`; labels your team added are never touched. A Markdown table in a description was shown in Jira as a line of pipes; it is now converted to a Jira table, so the next Sync offers to rewrite those descriptions. A Jira table with merged cells, a macro or a mention is still never flattened by accident.
