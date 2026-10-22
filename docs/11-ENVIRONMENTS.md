# Environments and deployment

## Local
`pnpm install`, then `pnpm dev` (http://localhost:3000). Copy `.env.example` to `.env.local` once variables exist.

## CI
`.github/workflows/ci.yml` runs lint, typecheck, test and build on every pull request and on pushes to `main`.

## Vercel (one-time setup by Ashu; cannot be done from the repo)
1. Import the GitHub repo in Vercel.
2. Set **Root Directory** to `apps/web`; framework preset Next.js. Keep "Include files outside the root directory" on (pnpm workspace).
3. Pull request previews are on by default for Git-connected projects.
4. Add environment variables per environment (Production / Preview / Development) as they are introduced. The list is `.env.example`. Variables without the `NEXT_PUBLIC_` prefix stay server-side; `SUPABASE_SERVICE_ROLE_KEY` is server-only.
5. Optional: require the CI check in branch protection for `main`.

## Secrets
Secrets only in environment variables. `.env*` files are git-ignored except `.env.example`.

## Database (Supabase)
- Migrations live in `packages/db/migrations/NNNN_name.sql`. They are forward-only: `pnpm db:migrate` applies new files in order, each in one transaction, and refuses to run if an already-applied file was edited. Fix mistakes with a new migration.
- Applying to a real project: set `DATABASE_URL` (Supabase > Project Settings > Database > Connection string) in your shell and run `pnpm db:migrate`. Do this for the Preview project first, then Production.
- Suggested setup: two Supabase projects, `product-velocity-preview` (used by Vercel Preview and Development) and `product-velocity-prod` (Production only). Use different keys in each.
- Tests (`pnpm db:test`) never touch Supabase. They create a throwaway database on the Postgres in `TEST_DATABASE_URL` and use `packages/db/tests/supabase-shim.sql` to imitate `auth.uid()` and the roles. CI runs a Postgres 16 service for this. Real-Supabase behaviour of the same policies is checked by running the migrations on the Preview project (still to do, see PR notes).
- Variables and their Vercel type: see `.env.example`.
- State of the real project `Provelo` (tnhlivowltvwvjhbknrc, eu-west-1): migrations 0001 to 0008 are applied and recorded in `pv_meta.schema_migrations` (0001 was first pasted into the SQL editor, 0002 to 0008 applied by Claude). `pnpm db:migrate` against it should print "Up to date". The Supabase security advisor lists five intentional warnings, all for functions signed-in users are meant to call: `create_tenant`, `accept_invitation`, `tenant_directory` (each checks the caller inside) and `is_tenant_member` / `is_tenant_admin` (used by the RLS policies; they only reveal the caller's own membership). No trigger function is callable through the API. The other signed-in-callable functions (`move_item`, `my_tenant_ids`, `my_editor_tenant_ids`, `my_admin_tenant_ids`) check the caller inside or only return the caller's own tenants. The advisor also notes (INFO) that the internal table `pv_internal.item_counters` has RLS and no policies: intended, it is not exposed through the API. `invitation_preview` (0006) and `invitation_account_exists` (0007) are intentionally callable by anonymous visitors, so the advisor also flags them ("anon can execute SECURITY DEFINER"); it only answers for the exact invitation token.

## Sign-in setup (Supabase Auth): one-time, in the Supabase dashboard
The app only works end to end once these are set. Ashu does them; Claude cannot change Auth settings.
1. **Authentication → URL Configuration**
   - Site URL: the production URL (the `*.vercel.app` domain for now).
   - Redirect URLs: add `https://<production-domain>/auth/callback`, a wildcard for previews such as `https://*-<your-vercel-team>.vercel.app/auth/callback`, and `http://localhost:3000/auth/callback`.
2. **Authentication → Providers → Email**: keep "Confirm email" ON (invitations rely on a confirmed email). Set the minimum password length to 10. Leave Supabase's "password requirements" (required character types) off: the app enforces its own rules (10+ characters, 2+ character kinds, not common, not part of the email) in the browser and on the server, and a stricter Supabase rule would make sign-up fail with a generic error.
3. **Authentication → Providers → Google** and **GitHub**: create an OAuth app in each (Google Cloud Console → OAuth client of type Web application; GitHub → Settings → Developer settings → OAuth Apps). Use the callback URL shown in Supabase (`https://<project-ref>.supabase.co/auth/v1/callback`), paste the client ID and secret into Supabase and switch the provider on.
4. **Authentication → Multi-Factor**: make sure TOTP is enabled (it is by default).
5. **Email delivery**: Supabase's built-in sender is limited to a few emails per hour and only delivers to members of your Supabase organisation. That is fine for testing with your own address. **Before inviting real people to sign up with email and password, set up custom SMTP** (Authentication → SMTP Settings; Resend is a common free-tier choice). This is a cost and provider decision for Ashu.
6. Optional on Vercel: set `SITE_URL` for Production.

Invitations do not send email: an admin copies the one-time link from Members and sends it themselves.

## Confirmation email template (one-time, Supabase dashboard; needs a paid Supabase plan)
> Editing email templates requires a paid Supabase plan (Pro). Until then, confirmation links only work when opened in the same browser that was used to sign up. This is acceptable while only Ashu and test users sign in; it goes on the go-live list below.

Sign-up confirmation links must work even when opened in a different browser or app than the one used to sign up (for example the mail app's built-in browser). The default Supabase link does not, because it needs a secret stored in the original browser. The app supports a link that carries a one-time token instead.

1. Supabase → **Authentication → Emails → Templates → Confirm signup**.
2. Replace the message body with:
   ```html
   <h2>Confirm your email</h2>
   <p>Follow this link to confirm your email address for Product Velocity:</p>
   <p><a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email">Confirm email</a></p>
   ```
3. Save. (`{{ .RedirectTo }}` is the app's `/auth/callback?next=...` address, hence the `&`.)

The app still accepts the old link in the same browser, so nothing breaks if this step is skipped; it just fails for people who open the email elsewhere. The password reset issue (#13) will need the matching **Reset password** template with `type=recovery`.

## Before going live for new customers (checklist)
Not needed while only the team is testing. Do all of these before the first real customer signs in. Owner: Ashu unless noted.

| # | Item | Why | Cost / effort |
|---|---|---|---|
| 1 | **Upgrade Supabase to a paid plan (Pro)** | Required to edit email templates (item 2); also gives backups, higher email and usage limits, and is where the custom domain add-on (item 5) lives | Paid, monthly. Check the current price on supabase.com/pricing |
| 2 | **Paste the confirmation email template** from the section above (and the Reset password one when #13 is built) | Makes email links work from any browser or mail app | Free once on Pro. 5 minutes |
| 3 | **Set up custom SMTP** (Supabase → Authentication → Emails → SMTP Settings; for example Resend) with a sender on `productvelocity.app` | The built-in sender only reaches members of your Supabase organisation and is heavily rate limited. Needs DNS records (SPF, DKIM) on the domain | Provider free tier may be enough at first. About 30 minutes |
| 4 | **Verify the app's branding with Google** (Google Cloud console → Google Auth Platform → Branding → submit for verification) | Replaces the raw Supabase address on the Google sign-in screen with "Product Velocity" and the logo; also lets any Google user sign in, not only listed test users | Free. Needs a public privacy policy and terms page on `productvelocity.app`; Google review can take days |
| 5 | **Supabase custom domain** (Project Settings → Add-ons → Custom Domain), for example `auth.productvelocity.app` | Sign-in screens (Google, GitHub) show your domain instead of `tnhlivowltvwvjhbknrc.supabase.co` | Paid add-on, check current price. Do it once, early: it changes the callback URLs in Supabase, Google and GitHub |
| 6 | **Build password reset** (issue #13) | People who forget a password or signed up with Google/GitHub need a way in | Claude, after items 2 and 3 |
| 7 | **Publish a privacy policy and terms page** | Needed for item 4 and for customers | Content decision for Ashu |
| 7b | **Turn on leaked-password protection** (Supabase → Authentication → Sign In / Providers → Email → "Prevent use of leaked passwords") | Rejects passwords found in known breaches (HaveIBeenPwned) on top of the app's own rules | Needs the paid plan, free once on Pro |
| 7c | **Upgrade Vercel to Pro** | Cron every minute (webhook and job processing), function duration up to 800 s, and Vercel's Hobby plan is meant for non-commercial use (check current terms) | Paid, monthly. Check the price on vercel.com/pricing |
| 8 | **Separate Supabase projects for Preview and Production** and use different keys | Preview deployments must never touch customer data | Free tier project, 15 minutes |
| 9 | **Require the CI check on `main`** (GitHub branch protection) | Stops broken code reaching production | Free, 5 minutes |
| 10 | **Set `SITE_URL`** to `https://productvelocity.app` in Vercel Production | Sign-in redirects and invite links always use the real domain | Free |

Order that avoids rework: 1 → 5 → 3 → 2 → 7 → 4 → 6 → 8 → 9 → 10.
