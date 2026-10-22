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
