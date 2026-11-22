---
issue: 588
status: done
logged: 2026-11-22
done: 2026-11-22
title: All accounts console v2 (AG Grid, usage and AI agents, pause, members from the console)
---
Ashu, as platform owner: "Improve the all accounts page. I want this in an AG grid with the standard search and filter options we already have. I want to see the account create date and the other fields already there. Also add the line item count as a column to understand usage. Also add if AI agents are connected and which ones. Allow me to impersonate and go to the account, allow me to pause access or delete the account. Allow me to see the members and add members, invite members, etc in the account, add company name and URL as columns. Add anything else that makes sense."

Built (docs/15 section 5c; decision `docs/decisions/2026-11-22-platform-accounts-console.md`): the grid on the default Roadmap grid kit and action bar (Filter, Columns, Group by, fold all, Search; remembered in the browser) with CSV export; columns Account, Company URL, Status, Plan, Owner, Created, Members, Pending invites, Access requests, Projects, Line items, Last activity, Last login, AI agents, GitHub, Jira, Platform access, Country; Enter and Manage on every row; a drawer with the details, Enter, Pause / Resume, Plan, read-only restriction, Delete with the typed name, and the people of the account with invite, renew, cancel and pause / resume / revoke. Migration `20261122153043_platform_accounts_console.sql`.

"Company name" is the account name: the product holds one organisation name per account (set in onboarding), so the Account column is the company name and Company URL is its website.
