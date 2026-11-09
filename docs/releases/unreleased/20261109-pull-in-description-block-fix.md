---
bump: patch
---
**Pulling in or re-pulling an issue now fills the Description even when its body holds a Product Velocity block.** Such issues were skipped silently, so the Description stayed empty while Change Type and Focus Area filled. The block is now cut out and the text around it is kept (or the block's own Description when nothing else is there). Re-pull also tells you when an issue has no text to copy.
