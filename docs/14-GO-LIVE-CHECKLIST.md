# Go-live checklist

Living list of things that must be done before real customers or real data. Owner: Ashu. Add items here (and a line in `docs/REQUESTS.md`) whenever one comes up. Tick with date when done.

## Hosting and repo (decided 2026-10-22: free plans for now)
- [ ] **Make the GitHub repo private.** Today it is public because the free Vercel and Supabase plans need it (Ashu's finding; not re-verified by Claude). Switching means upgrading the paid plans that support private organisation repos. Do this before go-live, not after.
- [ ] Upgrade **Vercel** to the plan that supports a private organisation repo, commercial use, and the function limits we need (check spike S6 results in `docs/08`).
- [ ] Upgrade **Supabase** (backups, no pausing, SAML later; check S7 results).
- [ ] Separate **production** Vercel and Supabase projects from previews and tests; production secrets only in environment variables.
- [ ] Decide **hosting region** (EU data residency) before the production database is created: it cannot be moved cheaply later.
- [ ] Custom domain, email sending domain (invitations, magic links), SPF/DKIM.

## While the repo is public (until the items above are done)
- Never commit secrets, real customer or voter data, or real commercial numbers. Docs such as `docs/09-PRICING-AND-PITCH.md` are visible to everyone: treat them as public.
- Use GitHub secret scanning and Dependabot (alert #1 still open, R-001).
- Before making the repo private, run a secret scan over the full git history; rotate any key that was ever committed.

## Security and compliance
- [ ] Dependabot alerts cleared; dependency audit in CI.
- [ ] Penetration-style review of tenant isolation (two-tenant RLS tests pass on every table, including the production database).
- [ ] 2FA on for all admins; GitHub App private key and webhook secret stored in production env only.
- [ ] Legal wording reviewed before real customers or participants are invited (consent, retention, "no delivery promises"); not needed for the fictional-data prototype (decided 2026-10-21).
- [ ] Prototype link "anyone with the link": remove or restrict once any real data is shown.

## Staff access (see `docs/15`)
- [ ] Terms and privacy policy state plainly that Product Velocity staff can access customer data (open content access), why, and that every access is logged and visible to customer admins.
- [ ] Staff access log visible to workspace admins; staff accounts require 2FA; at least two super-admins.
- [ ] Before the first staff member who should not see customer data: access grants and `content_access_mode = grant_required` are built and tested.
- [ ] Enterprise security answer prepared: who can access data, how it is logged, how it is restricted.

## Product and commercial
- [ ] Validate draft prices (`docs/09`) with 3–5 buyer conversations; no invented competitor claims in any copy.
- [ ] Billing (Stripe) built; seats and AI usage tracked from day one (Phase 9, pilot first).
- [ ] Pilot plan: one team, one quarter, success measures from the PRD §7.
- [ ] Onboarding and first-run flow designed and built (not yet designed).
- [ ] Notifications designed and built (email, in-app, Slack?) (not yet designed).
- [ ] Open product questions answered: AI agents as capacity, engineers split across two teams.

## GitHub App
- [ ] Production GitHub App registered under the company organisation, with the minimum permissions from `docs/04` and the Projects permission only if spike S2b says it is needed.
- [ ] Non-owner install and approval flow tested on a real enterprise organisation.

## Trash
- [ ] Schedule `select public.purge_old_trash(30)` daily (Vercel cron calling a route that uses the service role, or Supabase pg_cron on a paid plan). Until it runs, deleted items stay in the Trash past 30 days. The function is only callable by the service role.

- [ ] **Remove the spike harness for #30** before real customers: `apps/web/src/app/spikes/github/`, `apps/web/src/app/api/spikes/github-webhook/`, `apps/web/src/lib/spikes/`. Then point the GitHub App's webhook URL at the real webhook route and rotate the App private key and webhook secret that were used for the sandbox.

## Atlassian (see `docs/16`)
- [ ] Decide how the Atlassian app is distributed (private app for the customer vs Marketplace listing) and who approves it on the customer's site.
- [ ] Customer's real Jira data stays out of the repo, fixtures and screenshots; confirm data handling terms with the customer before the first read of their site.
- [ ] Token storage, revoke-on-disconnect and rate-limit handling reviewed.
