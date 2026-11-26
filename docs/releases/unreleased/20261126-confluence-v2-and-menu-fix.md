---
bump: patch
type: fixed
---
**Fix publishing to Confluence, and the row menu on links.** Publishing a document to Confluence failed with "This deprecated endpoint has been removed", because Confluence has removed the old interface Product Velocity was using for the list of spaces; it now uses the current one for everything (spaces, pages, creating and updating). The "⋯" menu on a link in the Spec tab no longer opens off the left side of the window: the new document-kind picker had pushed the menu onto a second line, and menus now also stay inside the window when a panel is narrow.
