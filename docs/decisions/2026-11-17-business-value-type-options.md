---
date: 2026-11-17
by: Ashu (2026-11-17, "update the options in the business value field to the unique items attached", then "update protect to Defend revenue", then "add Other next to Enabler"), built by Claude
status: built, to confirm
supersedes: the option names in 2026-11-05-value-type-and-quarter-labels.md
---
**Business Value Type options are now: New revenue · Grow existing revenue · Reduce costs · Defend revenue · Enabler.**

- "Other" is an option again, listed after Enabler (Ashu). Existing "Other" values were turned into Enabler by the first migration before this was asked; none existed in production.
- Ashu's screenshot showed New revenue, Grow existing revenue, Reduce costs, Protect and Enabler; Ashu then asked for "Protect" to be called "Defend revenue" (the old name is kept).
- **Mapping of existing data** (decided by Claude, please confirm): Increase revenue → Grow existing revenue, Decrease costs → Reduce costs, Defend revenue stays, **Other → Enabler** (the one judgement call; "Other" had no direct twin). New revenue is unchanged.
- Key `value_type` unchanged. Dictionary (`field-dictionary.json`, `item-fields.csv`), check constraint and data are updated by two forward-only migrations: `20261117223113_business_value_type_options.sql` (applied to production first, with the name Protect) and `20261117224500_business_value_type_defend_revenue.sql` (renames Protect back to Defend revenue). 0053 is untouched. The Leadership investment mix lists the values in this order.
- The tracker label `pv:value/<type>` keeps its old slug for Defend revenue (`pv:value/defend-revenue`); the other three follow their new names at the next Sync. Parity: same for GitHub and Jira.
- Not regenerated: `Roadmap_v4_field_dictionary.xlsx` (CSV and JSON edited by hand; regenerate from the workbook when it is updated).
