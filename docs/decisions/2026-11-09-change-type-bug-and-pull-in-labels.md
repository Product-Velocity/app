---
date: 2026-11-09
by: Ashu (instruction 2026-11-09), written by Claude
request: 364
status: built
---
**Pulling in a GitHub issue keeps its `type:` label as Change Type and its `area:` label as Focus Area, and Change Type gets a third value, Bug.**

**Why.** Ashu pulled in EARO issues labelled `area:admin` and `type:feature` and saw neither on the initiative: the labels lived only in the Incoming record. Ashu confirmed what they mean in Product Velocity (type = Change Type, area = Focus Area) and asked for Bug to be added to Change Type.

**The rules**
- When a person clicks Pull in, `type:<x>` and `area:<x>` are read from the issue's Incoming record (no extra GitHub call) and stored by `github_copy_issue_labels()`, with the same guards as the description copy (creator or admin who is a person; only an initiative made by the pull-in; audited as that person) and **only into an empty field**, so it never replaces what a person chose.
- **Change Type** takes exactly one distinct `type:` value that is a Change Type: feature / new feature, improvement / enhancement, bug / bug fix / defect. Anything else (`type:chore`, `type:docs`) or two different types are left out; nothing is guessed. **Focus Area** takes exactly one distinct `area:` value as written (whitespace collapsed, 120 characters at most); two different areas are left out.
- Other labels are not copied. Labels are not refreshed afterwards: this happens once, at pull-in. For a Product Velocity owned issue the existing outbound label `pv:type/…` follows the new value like any other.
- **Change Type: Bug (field dictionary v4, field 9).** `items.change_type` allows New feature, Improvement to existing feature and **Bug** (migration `20261109113103_change_type_bug`, existing rows unaffected). `docs/reference/item-fields.csv`, the workbook (`Roadmap_v4_field_dictionary.xlsx`: field row and the Dropdown lists sheet) and `packages/domain/src/field-dictionary.json` say the same. GitHub and Jira send the label `pv:type/bug`; GitHub also offers the organisation issue type `Bug` when the organisation has it. Nothing else about the field changes.

**Parity.** Built for both trackers: the Bug value and its `pv:type/bug` label, and the pull-in labels for Jira too (issue #365, `jira_copy_issue_labels`). **The Jira issue type (Bug, Story, Task, Epic) is not mapped to Change Type** (Ashu, 2026-11-09): only a `type:` label sets it.
