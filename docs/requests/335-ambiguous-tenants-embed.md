---
issue: 335
status: done
logged: 2026-11-05
done: 2026-11-05
link: PR #336 (the embed names its foreign key); Ashu confirmed the app loads again
title: Every page fails after the decision gates migration (ambiguous tenants embed, HTTP 300)
---
Ashu: "This page couldn't load" on every page right after the 0.98 migrations were applied to Provelo (digest 2727940785). Cause: `tenant_gate_approvers` is a second PostgREST path between `tenant_members` and `tenants`, so the bare `tenants(name)` embed in `loadMemberships` returns HTTP 300. Fixed by naming the foreign key in the embed.
