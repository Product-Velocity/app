---
bump: minor
---
**Documents go to GitHub and Jira as a name and a public link, and "Artifacts" is now "Links".** Instead of copying a document's text into the issue or the Jira description, a shared document is one line, "PRD: Brief (PRD, Approved)", linking to a read-only page of its current text that opens without a login (like file links; private repositories only for GitHub). "Do not share" ends the link at once; accepting an AI draft or sharing again makes a new address; a document with no text is skipped. The Spec tab can copy a document's public link. The section that held links is now called Links in both trackers (old issues still read back and are rewritten once at their next Sync). Migration `document_public_links` (apply it before deploying).
