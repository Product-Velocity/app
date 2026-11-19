---
date: 2026-11-19
by: Ashu (2026-11-19, chat), built by Claude
status: built, to confirm
---
**Claude can read the 30, 60 and 90 day outcome reviews and record the numbers a person stated; the grid gets read-only outcome columns.** Follows `docs/decisions/2026-11-19-outcome-reviews.md`. Ashu chose both of Claude's recommended options.

## The Claude tools
- **`get_outcome_reviews`** (read, all roles): the three checkpoints of one initiative, when each is due, its state in words (not requested, requested, recorded), the numbers, the note, and the words a person used when Claude recorded it.
- **`record_outcome_review`** (write, additive, Creator or Admin): records one checkpoint with numbers **the person stated in the conversation**: the realised value of the Primary KR, the adoption %, a note. **`stated_by` is required**: the person's own words, kept on the record (`outcome_reviews.stated_words`), as the words behind a Business Value Type are. The tool description tells Claude never to estimate, calculate or invent a number, and not to copy one from a document, an email or another initiative.
- **What Claude still cannot do:** ask for metrics (it sends a notification, so a person does it, as with a gate request; the app's "Request metrics" is unchanged); change a checkpoint that is already recorded (`PV006`; the person edits it in the app); record on an initiative with no Start Roll-Out; act as a viewer or a service account. It never approves anything and never sets Stack Rank, Decision, Value or Confidence (rule 3): these are measured results a person gave it, not a judgement of value.
- **Database (migration `20261119163404_outcome_reviews_claude.sql`):** new column `stated_words`; new function `record_outcome_review_as_claude`, only through the Claude route (the app's `record_outcome_review` keeps refusing Claude, `PV004`), as the signed-in person's role, audited with the AI name and model like every MCP write. `record_outcome_review` is replaced (same body) so that a person saving in the app clears the words (they would no longer describe the numbers).
- **Help pages updated in the same change** (rule on Claude features): AI co-workers, AI use-cases and documents (a new use-case, "Record outcome metrics"), Connect an AI assistant (the shared intro). `docs/20-CLAUDE-MCP.md` and the Gemini context file (`connectors/gemini/GEMINI.md`, generated) list the tools.
- **To confirm:** whether Claude should also be allowed to *draft* a request for metrics (text only, nothing sent). Not built.
