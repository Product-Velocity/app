---
date: 2026-11-23
by: Ashu
request: 565
---
**When someone asks about a quarter's roadmap, they mean the Planned Quarter field, and it is the first filter.** Ashu (2026-11-23): "when a user asks for the Q4-26 roadmap overview with statuses, this is the first filter to apply when getting the initiatives", for all skills and in general. Planned Quarter is `g2m_quarter`, a calendar quarter chosen by a person and stored as "Q4 2026".

- **Where it lives.** The always-on server instructions (every assistant, with or without a skill), the `search_items` description and a new `quarter` shortcut that is applied before every other filter, and the shared rules of every PV skill. The report skills take a quarter as a scope.
- **Spellings.** "Q4-26", "Q4 26", "Q4'26", "Q4/26", "26-Q4", "Q4 2026" and "2026-Q4" are the same value (`parseQuarter`, years 2000 to 2099 for two digits). Something that is not a quarter is refused with a message that names the format.
- **Never by dates.** The G2M date, the creation date and the phase dates are not used to decide which quarter an initiative belongs to (the app only shows a hint when they disagree, `quarterMismatch`). An initiative with no Planned Quarter is listed apart as having none and never assigned by guessing.
- **Overviews show statuses.** `search_items` now returns `g2m_quarter` and `initiative_status` by default next to Build Status, phase, health and rank.
