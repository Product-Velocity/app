---
issue: 658
status: done
done: 2026-11-24
link: PR (this branch)
logged: 2026-11-24
title: Claude load: Business Value text and Initiative Group values (checked)
---
After the 56-item load into R89 Roadmap Ashu saw Business Value in "his own words" and Initiative Group without enumerations. Checked against production (read only, 2026-11-24): Business Value Type holds only the six dictionary values or is empty on all 56 (none outside the list); the words are the `basis` Claude must record with each Business Value Type write (48 audit rows, all with a basis, via MCP; rule 3), shown in the audit log, not in the field. Initiative Group (`theme`, open list per workspace, `docs/DECISIONS.md` 2026-10-22) is empty on all 56 items, so nothing was set by the load. The workspace list has 22 groups: 5 are unused (Advertiser experience, Finance operations, Payments and Checkout, Publisher experience, Reporting), and two look like duplicates or typos ("github-sync" next to "GitHub sync", "PM Lyfecycle phases"). Nothing was changed: renaming, merging or deleting groups is Ashu's call (admin SQL functions exist for rename and merge).
