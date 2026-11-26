---
date: 2026-11-26
by: Ashu, built by Claude
request: none (asked in chat after trying the Confluence sync)
status: built, to confirm
---
**The Sync dialog treats Confluence like Jira, and what leaves the app no longer points back or into a Claude account.**

- **Same layout for both.** Step 2 has one section per place, each with the same header (a small label, "Jira" or "Confluence", and the title), a copy that starts "Nothing is written to X until you confirm", a list with a checkbox per row, and its own button. Rows use the brand's selected look (brand-tint with the pill capsule on the left edge) and the status pills carry their words.
- **Confluence previews load by themselves**, a few at a time, so the person ticks with the result in front of them. A page that can be updated is ticked; a text that may be commercial, a conflict, a deleted page, or a document that was also edited here is **not** ticked (a conflict and a deleted page cannot be ticked at all; they stay in the document's menu). One button applies the ticked rows, each with the token of its own preview, one after the other. Nothing is written by "Apply and send".
- **The counters include Confluence.** "To send" and "All" add the Confluence pages that wait (before, the Confluence list was not counted, so "To send (0)" showed an update).
- **No mention of Product Velocity and no link back on a published page.** The "Managed in Product Velocity… Open R-1 in Product Velocity" notice at the top of a Confluence page is gone, and so is the version message "Published from Product Velocity". The page holds the document's text only. Pages written earlier keep their old notice until the next update replaces the body; reading a page back still removes that notice. The GitHub issue's link back to the initiative is a separate thing and is unchanged; **to confirm with Ashu** whether it should go too (the shared-document links in GitHub and Jira point to a read-only page on our address, as decided 2026-11-06, because the text cannot be put in the tracker).
- **Links into a Claude account are not sent.** A link that opens only for its owner (claude.ai artifacts, chats and projects, and `claudeusercontent.com`) is left out of the GitHub issue, the Jira description and the Confluence page (in a document's text it is shown as plain text). A page made public (`claude.ai/public/...`) opens for anyone and is kept. The link stays on the initiative in Product Velocity.
