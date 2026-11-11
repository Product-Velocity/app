---
bump: patch
---
**Sync window names the right tracker everywhere.** Until it had looked up the project's tracker, the Sync window briefly said "GitHub" in its title, steps and "Checking…" text even for Jira projects; it now says just "Sync" until the tracker is known. The "managed block was edited" conflict text and the "Keep … for all conflicts" and "replaces the text in …" lines now name Jira, GitHub, or both when a sync covers both.
