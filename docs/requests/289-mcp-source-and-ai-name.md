---
issue: 289
status: done
logged: 2026-11-02
done: 2026-11-02
link: PR for issue 289
title: Write source "MCP" plus AI name and AI model on every audit entry
---
Ashu (2026-11-02): rename the write source `Claude MCP` to `MCP` (request #230 step 2) so that every entry has MCP, AI name and AI model/version. Built: migration `20261102223213_mcp_source_and_ai_name.sql`, audit log screen and CSV (How, AI name, AI model), optional `ai_model` on every write tool, Help "AI agents" text. Decision in `docs/decisions/2026-11-02-mcp-source-and-ai-name.md`. Done with the PR for issue 289. Apply the migration to Preview, then Production (it rewrites audit history once).
