---
date: 2026-11-28
by: Ashu (the decision); wording and scope by Claude, for Ashu to review
request: 748
---
**What goes in the Description field is the person's call, not a rule of the dictionary.** Issue #748. Ashu: nearly all GitHub and Jira projects are private, the rule restricted more than it protected, and a shortlisted initiative's one-pager should be able to live in Description in full.

1. **The note "Do not put value, customers or decisions in it" is removed** from the workbook (Field dictionary v4, Description row; GitHub sheet, "Issue body" note), `item-fields.csv`, `field-dictionary.json` and `docs/04`. The field's help text under the editor (it comes from the dictionary) now says the text is sent to GitHub and Jira, that everyone who can see the issue can read it, and that the person decides what goes in.
2. **Unchanged.** The commercial *fields* (value, confidence, customers requesting, decisions and rationale, key results, outcomes) still never sync, and the allowlist test still fails on any other field in a payload. Documents stay link-only to private repositories. The 20,000-character limit and the sanitising (our markers and @mentions neutralised) stay. The app does not scan Description.
3. **CLAUDE.md rule 2** gets one clause saying so.
4. **Not built, left open on #748:** a warning (never a block) in the sync preview when the repository is public or its visibility is unknown. Today the preview warns for document and file links but not for Description. Say if you want it.
5. **A caution that is the person's to weigh:** an item only reaches a tracker after its gate, but from then on the text is copied to the issue and stays in its edit history there, even if the field is later cleared.
6. **Tooling note.** `tools/field-dictionary/export.py` currently stops at an assertion (172 workbook rows against the CSV), so the JSON was edited by hand to match; the workbook was changed in place and the rest of it is untouched. Worth its own fix.
