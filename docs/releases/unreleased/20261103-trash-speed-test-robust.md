---
bump: patch
---
**Deleting many items: the speed check no longer fails by chance.** The automatic test that guards "deleting 100 items is one fast set-based step" used a fixed one-second limit, which failed on slow or busy machines even though nothing was wrong. It now counts the database statements and rows touched instead of the clock, so it gives the same answer on every machine and still fails if deleting becomes one step per item. No change to the product itself.
