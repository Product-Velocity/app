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
- State of the real project `Provelo` (tnhlivowltvwvjhbknrc, eu-west-1): migrations 0001 to 0005 are applied and recorded in `pv_meta.schema_migrations` (0001 was first pasted into the SQL editor, 0002 to 0005 applied by Claude). `pnpm db:migrate` against it should print "Up to date". The Supabase security advisor lists five intentional warnings, all for functions signed-in users are meant to call: `create_tenant`, `accept_invitation`, `tenant_directory` (each checks the caller inside) and `is_tenant_member` / `is_tenant_admin` (used by the RLS policies; they only reveal the caller's own membership). No trigger function is callable through the API.

## Sign-in setup (Supabase Auth): one-time, in the Supabase dashboard
The app only works end to end once these are set. Ashu does them; Claude cannot change Auth settings.
1. **Authentication → URL Configuration**
   - Site URL: the production URL (the `*.vercel.app` domain for now).
   - Redirect URLs: add `https://<production-domain>/auth/callback`, a wildcard for previews such as `https://*-<your-vercel-team>.vercel.app/auth/callback`, and `http://localhost:3000/auth/callback`.
2. **Authentication → Providers → Email**: keep "Confirm email" ON (invitations rely on a confirmed email). Set the minimum password length to 10.
3. **Authentication → Providers → Google** and **GitHub**: create an OAuth app in each (Google Cloud Console → OAuth client of type Web application; GitHub → Settings → Developer settings → OAuth Apps). Use the callback URL shown in Supabase (`https://<project-ref>.supabase.co/auth/v1/callback`), paste the client ID and secret into Supabase and switch the provider on.
4. **Authentication → Multi-Factor**: make sure TOTP is enabled (it is by default).
5. **Email delivery**: Supabase's built-in sender is limited to a few emails per hour and only delivers to members of your Supabase organisation. That is fine for testing with your own address. **Before inviting real people to sign up with email and password, set up custom SMTP** (Authentication → SMTP Settings; Resend is a common free-tier choice). This is a cost and provider decision for Ashu.
6. Optional on Vercel: set `SITE_URL` for Production.

Invitations do not send email: an admin copies the one-time link from Members and sends it themselves.

## Confirmation email template (one-time, Supabase dashboard)
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
