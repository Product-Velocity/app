---
date: 2026-11-17
by: Ashu (2026-11-17, issue 489), built by Claude
status: built, to confirm
---
**Objective and Business Line are two open text fields in the Why group; Sponsor is now Owner; Flags and Actions have their own group; GitHub names became tracker-neutral.**

- **Objective** (`okr_objective`) and **Business Line** (`business_line`): open lists like Focus Area (decision 246): any text up to 120 characters, the grid, panel, bulk bar and filters suggest the values in use and keep one spelling per value. The objective is written in full, with no separate number. **Nothing is seeded.** They are independent: no hierarchy, no filtering of one by the other, no defaults copied from one to the other, and an objective does not carry an owner, focus area or value type of its own. One Primary KR per initiative, as before. Shown by default only in the Leadership view (after Business Value Type); available in the Columns picker everywhere.
- **Never synced** to GitHub or Jira (added to `NEVER_SYNCED` with the KR fields): objectives are strategy, so the safe default. Say if a label should be offered.
- **Copy** to another project carries both values (`copy_items_to_project` replaced in migration `20261117225226_okr_objective_business_line.sql`; no other branch replaces it).
- **Sponsor is called Owner** (key `sponsor` unchanged; description "Person who sponsors the initiative"). Side effect: an imported column headed "Owner" now maps to this field instead of Product Manager.
- **Roadmap Category stays hidden.**
- **Flags & actions:** `flags` and `actions` move out of Delivery into their own group, last in the list.
- **Tracker-neutral names (labels only, keys unchanged).** The group "Delivery (GitHub)" is now "Delivery". Renamed: GitHub Links → Tracker Links, GitHub Sync State → Tracker Sync State, GitHub State → Tracker State, Last GitHub Activity → Last Tracker Activity, Iteration / Sprint (GitHub) → Iteration / Sprint, GitHub Target Date → Tracker Target Date, Locked (GitHub-driven) → Locked (tracker-driven). **Kept** because the idea is the same on both trackers or is about code hosting: Open PRs, Merged PRs, CI Status, Latest Release, Repositories, Assignees, Delivery Status. Whether Jira fills every one of them is a separate question; this changes names only. The editing mode "Locked (GitHub)" in the grid sheet is an internal value and is unchanged.
- Dictionary now has 174 fields. `Roadmap_v4_field_dictionary.xlsx` is not regenerated (CSV and JSON edited by hand).
