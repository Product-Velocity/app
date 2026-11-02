---
bump: minor
---
**Audit log: source "MCP", with the AI name and the AI model.** Everything an AI assistant writes is now recorded with the source MCP (it was "Claude MCP" for every assistant), the AI name (Claude, ChatGPT or Gemini, taken from the connection, so it cannot be faked) and the AI model the assistant says it is. The audit screens show it in the How column ("MCP · Claude · Claude Opus 5.5") and the CSV export has two new columns, AI name and AI model. Every tool that changes something accepts an optional `ai_model`. Earlier history is migrated once: old "Claude MCP" entries become MCP with AI name Claude. Migration `20261102223213_mcp_source_and_ai_name.sql` rewrites audit history and must be applied to Preview first, then Production.
