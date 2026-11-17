---
bump: minor
---
**Objective and Business Line, Owner, and clearer columns.** Two new open-text fields in the Why group, Objective and Business Line, suggest the values already in use and accept new ones; they are independent of each other, never sync to a tracker and show in the Leadership view. Sponsor is now called Owner. Flags and Actions have their own "Flags & actions" column group, the "Delivery (GitHub)" group is now "Delivery", and columns that were named after GitHub but work for Jira too have tracker-neutral names (Tracker Links, Tracker Sync State, Tracker State, Last Tracker Activity, Tracker Target Date). Migration `20261117225226_okr_objective_business_line.sql`.
