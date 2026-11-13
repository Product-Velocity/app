# Website and brand (draft, 2026-10-23, request R-027)

Status: proposal, waiting for Ashu's decisions. The full briefing and proposal is the Claude Docs document "Product Velocity: website briefing and proposal"; the brand guide is the Design System artifact "Product Velocity brand guide" (voice, claims rules, colour, type, health pills). Both live in Ashu's claude.ai account; this file keeps the decisions that affect the code.

## Proposal in short
- Launch site of eight pages plus legal: Home, Product, How it works, Claude, Integrations, Security, Pricing, Pilot and contact. Blog, changelog, docs and About come later.
- One primary call to action: **Start a pilot** (one team, one quarter).
- Separate static Next.js app `apps/site` in this monorepo, own Vercel project, MDX content in the repo, cookieless analytics, pilot form via a serverless route (email provider pending). Marketing on the root domain, product on `app.`.
- Copy follows the claims rules in the brand guide: no competitor claims, no invented proof, every claim true on launch day (the site is published only when the product is ready), Claude never approves, example data only (Meridian Media).
- Brand tokens (colour, type, spacing, radius, health pills) are defined in the brand guide; the app and the site should share them. Reconcile with the app's current CSS when the site is built.

## Loading and sync: the Rank pill loader (Ashu, 2026-11-13, issue #434)
The brand guide's "Loading and sync" section, option B. One component (`apps/web/src/components/pill-loader.tsx`): `PillLoader` (the logo's fifteen pills, lit one by one, opacity only, 1.5 s loop, 90 ms apart, `logo-blue`, white on a `brand` button, still with reduced motion) and `Loading` (glyph plus a word, `role="status"`, visible after 300 ms). Used for page, panel and dialog loads, "Saving…", pending buttons, the refresh button and the sync dialog; the tab title says "Syncing…" during a sync. A word always sits beside the glyph, and it is the only looping animation. Decision: `docs/decisions/2026-11-13-pill-loader.md`. Not built yet: the 400 ms minimum display time, empty states, import progress capsules and the gate-decided capsule.

## Positioning update (Ashu, 2026-10-23)
The story does not end at "shipped". Go-to-market and outcomes are tracked as an integrated part of the roadmap and lifecycle. Product Velocity does not replace GitHub, Jira, Bitbucket, GitLab or Confluence; it connects them, pushes information forward across the lifecycle, and gives people and AI the insight to deliver fast. Clear dashboards per stakeholder: leadership sees priorities, planning and progress; stakeholders are aligned; expected impact is clear and measured; the team learns and gets ideas on where to improve. Tagline decided by Ashu on 2026-10-23: "One roadmap for humans and AI" (supporting line "It doesn't end at shipped"; "From idea to impact, at AI speed" is retired because it echoes Jira Product Discovery and Dragonboat). Proposed wording (pending Ashu): a fourth pillar **Impact**, and a one-liner that names go-to-market and outcomes. The PRD one-liner and tagline (`docs/01`) change only after Ashu approves. The site goes live only when the product is ready (Ashu, 2026-10-23), so copy describes the product as it will be at go-live, including Jira, Bitbucket, GitLab, adoption and outcomes. Every claim must be true on launch day; a pre-launch check verifies each against what has shipped, and if something is not ready the copy changes, not the claim. The briefing also lists customer pain points and the feature that solves each.

## Decisions needed from Ashu before building
1. Launch scope (focused pre-launch site recommended).
2. Call to action (pilot, not self-serve).
3. Domain and legal entity name.
4. Pricing: show plan shapes without prices until validated. Note that draft prices are already public in `docs/09` while the repo is public.
Other open questions are listed in the briefing.

Do not build the site until these are confirmed; then create the issue(s) from the briefing's plan.

## Brand refresh applied (2026-11-10)
Ashu's updated brand guide (design-system artifact, updated 2026-11-10) replaces the indigo `#3347D9` and the "P" placeholder: brand blue `#2270ED` (text `#1A56C4`, tint `#E8F1FE`), and the pill logo (fifteen white pills in a 5·4·3·2·1 triangle on a rounded square in the fixed `logo-blue`). Applied in the app: `tokens.css` (old names kept, brand names added), all hard-coded blues in `globals.css`, charts and the grid accent, `BrandLogo`/`BrandMark` (inline SVG, live-text name), favicon (`icon.svg`, `favicon.ico` 16/32/48), `icon.png` 512, `apple-icon.png` 180, `public/brand/` (SVGs, 192px icon), the web manifest, the email frame and the three Supabase auth templates (tile at 48px plus the name as text), and the `pv:removed` GitHub label colour. Decision: `docs/decisions/2026-11-10-brand-refresh.md`. Still to do from the guide, not part of this change: the pill motif (selected-row capsule, capsule bars, gate funnel, Fit line), which the guide marks "proposed".
