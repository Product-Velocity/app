---
issue: 230
status: in progress
logged: 2026-10-30
title: Gemini and ChatGPT connectors, assistant-neutral MCP, memory, group review and research for discovery and PRD
---
Ashu (2026-10-30): "Start building the Gemini MCP connector and the ChatGPT MCP connector. Make the Claude MCP generic in terms of the features we build there, including setting up the memory, reusing the memory, doing the research for discovery and PRD and reviewing the other tickets from the same initiative group. Do not ask me for Supabase permissions. Just do and finish building. Do not deploy." Existing issue #230 (R-112) already covered Gemini and client neutrality; ChatGPT, memory, group review and research check are added here. Built in `docs/27-AI-ASSISTANTS-AND-MEMORY.md`. Left open: the write-source rename (step 2), the live tests S8c, and applying the migration `20261030001116_assistant_memory.sql` (not applied anywhere; nothing deployed).
