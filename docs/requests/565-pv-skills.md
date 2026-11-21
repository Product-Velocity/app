---
issue: 565
status: in progress
logged: 2026-11-21
title: PV skills in the MCP connector (pv-<skill> commands)
---
Ashu (2026-11-21): many product-management skills fit the platform; bring the relevant ones in as part of the MCP connector, customised to PV fields and flow, with a strong, logical command syntax `pv-<skill> [user input]`. Every skill (1) uses the company context we store (and expands it), (2) asks questions to reach better context and quality, (3) uses data already in PV, (4) uploads the Markdown it writes into PV and sets column values where relevant.

Decided in the same conversation: syntax accepted; scores are advisory (and must work with the alignment tools, see `docs/31-SKILLS.md` section 6); the new documents table also holds the company documents so all are in one place; our own design and our own wording (no text copied, no inspiration source named); build slices 1, 2, 3 and 5 (slices 4, 6 and 7 later).
