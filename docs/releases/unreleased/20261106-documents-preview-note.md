---
bump: patch
---
**The Sync preview names the documents it sends, and empty documents are skipped.** For GitHub and Jira the preview now says which documents go into the issue or description ("Documents in the Jira description: PRD, Discovery"), which were skipped because they have no text yet, and which were cut or left out to fit the size limit. A document with no text is no longer sent as a bare heading.
