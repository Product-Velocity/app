---
issue: 230
status: in progress
logged: 2026-10-30
title: Gemini and ChatGPT connectors, AI tool and model on documents, document log, team block, AI agents Help
---
Ashu (2026-10-30): build the Gemini and ChatGPT MCP connectors and make the Claude MCP generic. Memory, group review and research check already exist for Claude, so they were taken out again. Then asked for: (1) columns showing the AI tool and the model used to generate a document, for later model comparison, including a PRD written with Claude and reviewed by ChatGPT; (2) the activity log to include document submissions (user, project, initiative, document type, date, link to open) for the account admin and the platform admin; (3) the "name/owner" part of document templates renamed "team", with the team asked for in the chat (product manager, designer, engineering manager and so on); (4) Help restructured as AI agents: Use-cases, Claude, ChatGPT, Gemini. Built in `docs/27-AI-ASSISTANTS.md`. Left open: the write-source rename (request #230 step 2), the live tests S8c, and applying migration `20261030091015_document_ai_tool_model.sql` (not applied anywhere; nothing deployed).
