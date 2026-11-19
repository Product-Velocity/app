---
bump: minor
---
**Claude can read and record outcome reviews.** Two new Claude tools: `get_outcome_reviews` reads the 30, 60 and 90 day reviews of an initiative, and `record_outcome_review` records a checkpoint with numbers you state (the realised value of the key result, the adoption % and a note), keeping your own words next to them. Claude never asks anyone for metrics, never invents a number and cannot change a checkpoint that is already recorded. The Help pages are updated. Migration `20261119163404_outcome_reviews_claude.sql` (a column and a function on `outcome_reviews`).
