---
date: 2026-11-23
by: Ashu
---
**Throwaway spike routes removed after a security review.**
Requested by Ashu. Scope: login, data access, impersonation, from inside and outside the platform.

## Finding (critical, fixed)
`/spikes/github` (spike #30) was reachable by **any workspace admin of any workspace**, which includes everybody who signs up and creates their own workspace. Its "probe" action called the GitHub API as the Product Velocity App (`auth: app`, signed with `GITHUB_APP_PRIVATE_KEY_B64`). The path allowlist was a `startsWith` check, so `/app/hook/deliveries/../../installations/{id}/access_tokens` passed it and `fetch` normalised the `..`: a signed-in user could list every customer's installation, read webhook deliveries (payloads of other customers) and mint installation tokens for other customers' repositories, and the token came back in the response.
Also removed: `/spikes/atlassian`, `/api/atlassian/start` and the spike half of `/api/atlassian/callback` (admin of any workspace could run write probes against a Jira site they connected), `/api/spikes/*` receivers.

## Changes
- Deleted the spike pages, routes and `lib/spikes/{github-app,checks,checks-shared}`; the Atlassian callback now only completes the signed `pv1.` connection state.
- Cron endpoints compare `CRON_SECRET` in constant time (`lib/cron-auth.ts`).
- Added HSTS, Permissions-Policy, COOP and a baseline CSP (`frame-ancestors 'none'; base-uri 'self'; object-src 'none'`). `form-action` is left out on purpose: Chrome applies it to redirects after a form post and would break the AI-assistant consent hand-back. A script-src CSP needs nonces and is a separate slice.
- `no-throwaway-routes.test.ts` fails if a `spikes` route comes back.

## To do by Ashu (go-live checklist)
Rotate the GitHub App private key and webhook secret if the App used in production is the one the spikes ran with; check the GitHub App's "Advanced > Recent deliveries" and installations for unknown token requests.
