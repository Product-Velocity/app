---
date: 2026-11-25
by: Ashu (2026-11-25, issue 676), built by Claude
status: built, to confirm
---
**Summary guidance is 4,000 characters and Markdown; G2M Effort is a new pill in the When group.**

- **Summary.** The dictionary said "max ~280 chars"; Ashu asked for 750, then for 4,000, the hard limit the column already had (`summary` check 4000, unchanged). The text is Markdown: Write/Preview in the item panel, plain line plus rendered tooltip in the grid, rendered in alignment sessions and on the participant ballot (no raw HTML, no images, links open in a new tab, rule 4). It already went to GitHub and Jira as Markdown sections.
- **G2M Effort** (`g2m_effort`, N57, When, Select): XS · S · M · L · XL; blank means no go-to-market effort or not estimated yet (follow-up the same day: a stored word "None" showed twice in the picker, which already offers a blank "None" choice; migration `20261125154549_g2m_effort_blank_means_none.sql` blanks stored words). Shown as a coloured pill, green (XS) to red (XL), the word always in the text. Shown by default in Planning and Go-to-market after G2M Date (est); in the Columns picker everywhere. **Not synced** to GitHub or Jira (no slot), so nothing to build for either tracker. Copied with an initiative (`copy_items_to_project` replaced in migration `20261125130935_g2m_effort.sql`; no other branch replaces it). It does not require an estimate basis (unlike Effort (T-shirt)).
- Dictionary now has 178 fields; the xlsx is not regenerated (CSV and JSON edited by hand).
