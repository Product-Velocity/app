---
issue: 549
status: done
logged: 2026-11-19
done: 2026-11-19
link: the PR for issue 549 (robots.txt allows /sitemap.xml)
title: Search Console could not fetch the sitemap
---
Ashu, 2026-11-19: Google Search Console shows "Couldn't fetch" for https://productvelocity.app/sitemap.xml. The file itself is valid (200, application/xml); robots.txt disallowed everything except the listed public pages, and /sitemap.xml was not on the list. Decided: allow /sitemap.xml explicitly.
