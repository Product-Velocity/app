---
bump: minor
type: new
---
**MoSCoW is a new way to vote in an alignment session, and an admin can set the MoSCoW from the result.** Each person chooses Must, Should, Could or Won't for every initiative (there is no "no opinion"), on their phone like the other methods. The results page suggests a MoSCoW per initiative with the share of each choice; a tie goes to the more cautious choice and is marked contested, as is an initiative that got both Must and Won't. An admin then sees what each initiative has now, ticks the ones to set, changes a value if needed, gives a reason wherever it differs from the vote and reviews the changes before anything is written; a value that is set now is overwritten only for the ones left ticked, and the whole change can be undone while nothing has changed it since. Claude cannot set it. Migrations `20261128115001_alignment_moscow` and `20261128120403_alignment_moscow_apply`.
