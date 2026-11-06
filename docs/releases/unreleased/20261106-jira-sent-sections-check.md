---
bump: patch
---
**Jira: the Links, Files and Documents sections are checked against what Jira shows.** A Sync used to decide whether to rewrite these sections only from a stored record of the last send. Now it also compares what the Jira description shows today with what would be written, so a description that still has old content (for example the full document text from before documents became links) is rewritten at the next Sync, and the record only moves when the rewrite really happened.
