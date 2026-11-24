---
issue: 656
status: done
done: 2026-11-24
link: PR (this branch)
logged: 2026-11-24
title: Jira read-only mode per project, with epic links read inside Product Velocity
---
Ashu loaded 56 items into R89 Roadmap through the Claude connector, linked to Jira, and does not want to send initiatives to Jira yet, only to listen to the connected epics and their statuses. Built: a per-project "Access to Jira" setting on the Projects table (read only blocks every Jira write; switching to "can write" later sends nothing by itself) and a read path that reads the epics listed on an initiative by key. Details in `docs/decisions/2026-11-24-jira-read-only-mode.md`. Open: the GitHub twin (#657), epic history for build dates.
