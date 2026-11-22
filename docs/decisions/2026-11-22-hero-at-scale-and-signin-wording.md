---
date: 2026-11-22
by: Ashu
request: 580
---
**The hero lead says the product works at scale, and the sign-in screen now uses the new homepage wording** (follow-up to `2026-11-22-homepage-agentic-pm-story.md`).

- **Hero lead:** "... one roadmap with the context, the place for the work and the path from start to finish, across business lines, PM scopes and teams. AI prepares, people decide."
- **Sign-in side (`AUTH_BRAND` in `components/auth-shell.tsx`):** eyebrow "Agentic product management platform", headline "Deliver bigger, better outcomes. Faster.", the same lead, one line "One roadmap for humans and their AI, from company OKR to tracked outcome", and four pillars: Context, Alignment, Velocity, Outcomes. This replaces the note in `2026-11-21-new-homepage.md` that the sign-in wording stays.
- **/classic** keeps its own hard-coded wording (it is frozen and noindex); the test that tied it to `AUTH_BRAND` now checks the sign-in side against the new homepage instead.
