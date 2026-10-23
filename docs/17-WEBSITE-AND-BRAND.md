# Website and brand (draft, 2026-10-23, request R-027)

Status: proposal, waiting for Ashu's decisions. The full briefing and proposal is the Claude Docs document "Product Velocity: website briefing and proposal"; the brand guide is the Design System artifact "Product Velocity brand guide" (voice, claims rules, colour, type, health pills). Both live in Ashu's claude.ai account; this file keeps the decisions that affect the code.

## Proposal in short
- Launch site of eight pages plus legal: Home, Product, How it works, Claude, Integrations, Security, Pricing, Pilot and contact. Blog, changelog, docs and About come later.
- One primary call to action: **Start a pilot** (one team, one quarter).
- Separate static Next.js app `apps/site` in this monorepo, own Vercel project, MDX content in the repo, cookieless analytics, pilot form via a serverless route (email provider pending). Marketing on the root domain, product on `app.`.
- Copy follows the claims rules in the brand guide: no competitor claims, no invented proof, a feature is "available" only after it ships, Claude never approves, example data only (Meridian Media).
- Brand tokens (colour, type, spacing, radius, health pills) are defined in the brand guide; the app and the site should share them. Reconcile with the app's current CSS when the site is built.

## Positioning update (Ashu, 2026-10-23)
The story does not end at "shipped". Go-to-market and outcomes are tracked as an integrated part of the roadmap and lifecycle. Product Velocity does not replace GitHub, Jira, Bitbucket, GitLab or Confluence; it connects them, pushes information forward across the lifecycle, and gives people and AI the insight to deliver fast. Clear dashboards per stakeholder: leadership sees priorities, planning and progress; stakeholders are aligned; expected impact is clear and measured; the team learns and gets ideas on where to improve. Proposed wording (pending Ashu): tagline "From idea to impact, at AI speed", a fourth pillar **Impact**, and a one-liner that names go-to-market and outcomes. The PRD one-liner and tagline (`docs/01`) change only after Ashu approves. Outcomes and adoption are Phase 7 [R2], so the site says "coming" until they ship.

## Decisions needed from Ashu before building
1. Launch scope (focused pre-launch site recommended).
2. Call to action (pilot, not self-serve).
3. Domain and legal entity name.
4. Pricing: show plan shapes without prices until validated. Note that draft prices are already public in `docs/09` while the repo is public.
Other open questions are listed in the briefing.

Do not build the site until these are confirmed; then create the issue(s) from the briefing's plan.
