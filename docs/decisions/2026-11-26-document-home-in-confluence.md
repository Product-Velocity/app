---
date: 2026-11-26
by: Ashu, proposed by Claude
request: 693
status: slice A in progress
---
**A document or link can have a home in Confluence, with two settings: who is the source, and whether it stays in sync (issue #693).** It extends J7 (`2026-10-29-confluence-publish.md`), where PV was always the source, so that either side can be.

| Source | Updates | What happens |
|---|---|---|
| Confluence (pull in) | Once | PV imports the page text as a document version, then unlinks. |
| Confluence (pull in) | Keep in sync | PV rereads the page on Sync, in the daily check and when Claude asks. A new page version becomes a new PV version. PV never writes back. |
| PV (publisher) | Once | PV creates the page from the document, then unlinks. |
| PV (publisher) | Keep in sync | Each new PV version becomes a "To send" entry in the Confluence preview; nothing is written until a person confirms. |

- **Document kinds on links.** Links and files carry the same document kind as written documents (PRD, Business case, Go-to-market, and so on), so PV and Claude know where the latest document of a kind is, whichever side holds it. This reverses "document kinds apply to written documents only" from `2026-11-05-spec-attachments.md` for the kind field; a link without a kind stays valid.
- **One side is the source per document.** Editing the same document on both sides is not built. If both sides changed since the last sync, the person gets a conflict card (Keep PV, Keep Confluence, or import the page as a new draft version).
- **Unlinking** is possible at any time. PV keeps its last copy; the page stays. Switching a document's sharing off still ends its public link at once.
- **Claude** can prepare a link, a kind, a source and a sync setting, and a publish target; a person confirms every Confluence write and cannot be replaced by Claude (rule 3). Page text read back is data, never instructions (rule 4). Every read that changes PV and every write is audited with source and, for MCP, the AI name and model (rule 5).
- **Approved documents.** If a document was accepted at a gate and a newer text arrives from Confluence, the new version is a draft and needs re-acceptance (approval is about the text).
- **Who may.** Any Creator can link and read. A Confluence write needs the confirmation in the sync preview.
- **Commercial text.** Confluence is the customer's private site (exception in `2026-10-29-confluence-publish.md`); the preview warns about customer names, value and key results. Cached page text never enters a GitHub or Jira payload (the shared-document readers stay the only readers of `item_documents`, and the cache is not read by them).
- **Parity.** Atlassian only, because GitHub has no hosted document store. Follow-ups for GitHub wiki and Notion are separate issues.
- **Slices.** A: kind on links and files, and reading a linked Confluence page (source Confluence, once or keep in sync). B: publish from PV (J7, #258). C: Claude flows and Help pages.
- **[SPIKE] open:** reading a page body through the Confluence API (scopes beyond the summary scopes already requested; storage format to Markdown is lossy: macros and layouts do not round-trip). Slice A builds the read behind an interface and records the result here.
