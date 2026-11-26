---
issue: 693
status: in progress
logged: 2026-11-26
title: Documents with a home in Confluence (kinds on links, pull in, publish)
---
Ashu asked whether links could carry the same document kinds as written documents, so PV and Claude know where the latest document for X lives, and whether Claude could create and update documents that PV stores in Confluence and links back. Decided in chat 2026-11-26: for a linked document, set who is the source (Confluence pulls in, PV publishes) and whether it stays in sync (with a preview and confirmation) or is a one-off copy; any document, including ones Claude wrote, can be set to publish to a place, once or kept in sync. See `docs/decisions/2026-11-26-document-home-in-confluence.md`. Slices: A (this PR), B (publish, J7 #258), C (Claude flows, Help).
