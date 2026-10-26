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
- [ ] Onboarding and first-run flow designed and built (issue #106; board 31 still to be designed).
- [ ] Notifications designed and built (design note `docs/19-NOTIFICATIONS.md` first; issue #104; Slack is #154).
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
- [ ] **Create the real GitHub App** (not the sandbox one) with least privilege (`docs/04`), its own webhook secret and private key, the Setup URL `/api/github/setup` and webhook URL `/api/github/webhook` on the production domain; put its variables in Vercel Production and rotate the sandbox App's key and secret (the sandbox App's key has been pasted into a Claude Code environment). Owner approval for permission changes applies to every customer install.
- [ ] Decide whether `GITHUB_APP_WEBHOOK_SECRET` should stay the key for install-state tokens or get its own variable before many customers use it.


## Website (see `docs/17`)
- [ ] Domain, legal entity name and contact in the footer; legal pages reviewed.
- [ ] Draft prices in `docs/09` are public while the repo is public: decide before go-live whether to keep them in the repo.
- [ ] Every site claim checked against the claims rules in the brand guide.
- [ ] **Prune `sync_events`** (the sync log) after a retention period, for example 90 days, and decide the production Cron schedule (the free plan allows once a day; Pro allows every minute, which suits reconciliation).

- [ ] Re-check the Vercel function region (`apps/web/vercel.json`, `dub1`) against where the customers and the paid Supabase project are; a multi-region setup needs a paid Vercel plan.
- [ ] Scaling (`docs/18-SCALING.md`): partition `audit_log` by month with archiving, prune `sync_events` (90 days), move syncs to a per-customer queue, use the Supabase pooler (transaction mode), re-measure size and speed on real data, and add server-side paging to the Incoming list before Jira ships.
- [ ] Supabase Auth: switch on "Enable Manual Linking" (Authentication > Sign In / Providers) so people can add or remove Google and GitHub on the account page; test it with a real Google and a real GitHub account.
- [ ] Invitation emails (`docs/11`): verify the sending domain at Resend (SPF and DKIM), set `RESEND_API_KEY` and `EMAIL_FROM`, add the Resend webhook for delivered, bounced and complained (`RESEND_WEBHOOK_SECRET`), turn open and click tracking off, then send a test invitation to an outside address and check it arrives (not in spam).

- [ ] Alignment emails (0.24.0): the Resend sender domain is verified and `RESEND_WEBHOOK_SECRET` is set (bounces and spam marks of participants arrive through the same webhook as invitations); `CRON_SECRET` is set so the daily job clears participants' personal data after the retention time.
- [ ] Alignment participants: the join page wording (`CONSENT_LINES` in `apps/web/src/lib/alignment.ts`) is reviewed by whoever answers for privacy, the consent version is bumped when it changes, and a rate limit in front of `/a/*` (Vercel firewall) is switched on before real voters.

- [ ] Files (0.28.0): put a rate limit in front of `/f/*` (Vercel firewall), check the Storage bucket `item-files` is private in Supabase, decide on a virus scan for uploads, and decide whether share links should expire.
