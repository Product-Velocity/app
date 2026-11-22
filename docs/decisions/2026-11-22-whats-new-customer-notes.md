---
date: 2026-11-22
by: Ashu
request: 594
---
**The "What's new" screen follows the customer-notes part of the `pv-release-notes` skill** (`docs/32-SKILLS-REFERENCE.md`).

- Entries are grouped by date, then under New, Improved, Fixed, Retired and Security (only the groups that apply). Each entry is a bold title and a short plain description; the title is no longer repeated in the text.
- Version and build move to quiet lines; dates are written in full.
- **Left out on purpose (Ashu):** the skill's "For support and success (internal)" and "Not in these notes" sections. The screen shows customer notes only.
- A release fragment may carry `type: new|improved|fixed|retired|security`; `tools/release/assemble.mjs` writes it as a hidden `<!--type:...-->` mark at the start of the "Key updates" cell. Older rows have no mark: a title starting with "Fix" reads as Fixed, "New", "Introducing" or "Add" as New, anything else as Improved.
- Not done: rewriting old entries; one release note per version range (the screen still shows one entry per release).
