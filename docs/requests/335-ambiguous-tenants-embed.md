---
issue: 335
status: in progress
logged: 2026-11-05
title: Every page fails after the decision gates migration (ambiguous tenants embed, HTTP 300)
---
Ashu: "This page couldn't load" on every page right after the 0.98 migrations were applied to Provelo (digest 2727940785). Cause: `tenant_gate_approvers` is a second PostgREST path between `tenant_members` and `tenants`, so the bare `tenants(name)` embed in `loadMemberships` returns HTTP 300. Fixed by naming the foreign key in the embed.
