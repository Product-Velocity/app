---
date: 2026-11-17
by: Ashu (2026-11-17, "update the options in the business value field to the unique items attached"), built by Claude
status: built, to confirm
supersedes: the option names in 2026-11-05-value-type-and-quarter-labels.md
---
**Business Value Type options are now: New revenue · Grow existing revenue · Reduce costs · Protect · Enabler.**

- Ashu's screenshot showed these five values; they replace New revenue · Increase revenue · Defend revenue · Decrease costs · Other.
- **Mapping of existing data** (decided by Claude, please confirm): Increase revenue → Grow existing revenue, Decrease costs → Reduce costs, Defend revenue → Protect, **Other → Enabler** (the one judgement call; "Other" had no direct twin). New revenue is unchanged.
- Key `value_type` unchanged. Dictionary (`field-dictionary.json`, `item-fields.csv`), check constraint and data are updated by migration `20261117223113_business_value_type_options.sql` (forward-only; 0053 is untouched). The Leadership investment mix lists the new values in this order.
- The tracker label `pv:value/<type>` follows the new name at the next Sync (the old label is removed like any `pv:` label that no longer applies). Parity: same for GitHub and Jira.
- Not regenerated: `Roadmap_v4_field_dictionary.xlsx` (CSV and JSON edited by hand; regenerate from the workbook when it is updated).
