---
date: 2026-10-29
by: Ashu
request: 253
---
**New tracker items are decided inside "Sync with GitHub / Jira", and ownership is chosen per item: Read only or PV takes ownership (Adopt).** Step 1 sends what changed in PV; step 2 shows new items found in the tracker (the Incoming triage, embedded) and asks Pull in or Ignore, and for pulled items Read only (follow) or PV takes ownership. Ownership is the link mode (`push` or `follow`), not a new dictionary field; the Source field stays a free-text label. Adopting never overwrites by itself: only a later change made in PV goes out, through the normal preview. Status fields (Build Status, delivery progress, PR and CI) stay read-only in every case, and Initiative Status stays with people (rule 6). Internally the sync still reads the tracker before it writes, so no change is overwritten unseen. The standalone Incoming page stays as the full-size view for large backlogs.
