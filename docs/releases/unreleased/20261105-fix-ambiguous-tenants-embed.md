---
bump: patch
---
**Fix: every page failed to load after the decision gates migration.** The list of a person's workspaces was read with an ambiguous link to the workspace table once the gate approvers table existed (the server answered "multiple choices"), so each signed-in page showed "This page couldn't load". The read now names the link it uses. Tests pin it.
