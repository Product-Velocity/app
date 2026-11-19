---
bump: minor
---
**30, 60 and 90 day outcome reviews, and a button to ask for them.** An initiative in Roll-out or Completed now shows an "Outcome review due" flag when a checkpoint (30, 60 or 90 days after Start Roll-Out) comes due, with the action "Request 30-day metrics" in the Roadmap and the Changes report. The request notifies the Product Manager (else the person who created the initiative). The item panel has a new "Outcome reviews" section to record the realised value of the Primary KR, the adoption % and a note for each checkpoint. Migration `20261119140716_outcome_reviews.sql` (new table `outcome_reviews`).
