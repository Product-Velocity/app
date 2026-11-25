---
bump: patch
type: fixed
---
**Fix: G2M Effort listed "None" twice; it is now a coloured pill.** The picker offered a blank "None" and a stored word "None"; the word is gone, so blank means no go-to-market effort. The values are XS to XL, drawn as pills from green (XS) to red (XL) in the grid and on cards, with the size always written. Migration `20261125154549_g2m_effort_blank_means_none.sql` blanks any stored "None".
