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
