# Working with several agents at the same time

Issue #238. Parallel agents kept colliding on numbers that someone had to pick by hand: request ids, versions, migration numbers, and the top row of shared tables. Git cannot see most of those conflicts, so the fix is to stop allocating numbers by hand and to catch the rest in CI.

## What changed in the repository
| Was | Is now |
|---|---|
| Migration `NNNN_name.sql`, next number picked by hand | `YYYYMMDDHHMMSS_name.sql` (UTC). `pnpm db:new <name>` creates it. The numbered set 0001 to 0058 is frozen; a test refuses a new four-digit name, a duplicate timestamp or a name out of order. |
| Every PR bumps `version` and edits the top of `docs/RELEASES.md` | A PR adds a fragment in `docs/releases/unreleased/` (see its README). When it is merged into `main`, `.github/workflows/release.yml` runs `tools/release/assemble.mjs`: next version, row in `docs/RELEASES.md`, `package.json` bumped, fragment removed. |
| Requests as rows of `docs/REQUESTS.md`, ids R-nnn chosen by hand | One file per request in `docs/requests/`, named by the **GitHub issue number**. Create the issue first. |
| Decisions appended to `docs/DECISIONS.md` | One file per decision in `docs/decisions/`. |
| | `docs/REQUESTS.md` and `docs/DECISIONS.md` stay as the archive up to now. A row still `open` in `REQUESTS.md` is still a request to pick up. |

## Rules for every agent
1. **Claim before you start.** Assign the GitHub issue to yourself (or set the request file to `in progress`) and say which area you will change. Look at the open pull requests first: if one touches the same files, wait or ask Ashu.
2. **One agent per area.** The worst conflicts are two agents changing the same logic. Areas: the grid, the item panel, GitHub sync, the MCP server, accounts and admin, the database functions.
3. **Same SQL function, one at a time.** Our migrations replace whole functions (`create or replace`, for example `items_guard`, `mcp_apply`). Two branches doing that to the same function merge cleanly in git, and the later one silently erases the other's change. Check open branches for the function name before you replace it, and say which functions you replace in the migration header.
4. **Short branches.** Merge small slices often; use a feature switch or an unreachable route for unfinished work instead of a long branch.
5. **Merge `main` before the PR, and again when it moves.** Run the whole suite (`pnpm lint && pnpm typecheck && pnpm test && pnpm db:test`) on the merged result.
6. **Never rewrite or force-push a branch someone else uses.** If your branch was already merged, start it again from `main` and keep only the unmerged commits (a merge with `-s ours` of the old tip makes the push a normal one).
7. **One concern per PR.** The PR description says "version assigned when merged", never a number.

## Settings for Ashu (GitHub, cannot be done from code)
All of this is in the repository on github.com: `https://github.com/Product-Velocity/app/settings`. You need the Admin role.

**A. Let the release workflow push (do this first, two minutes).**
1. Open `https://github.com/Product-Velocity/app/settings/actions`.
2. Scroll to **Workflow permissions**, choose **Read and write permissions**, press **Save**. (If the option is greyed out, an organization setting overrides it: `https://github.com/organizations/Product-Velocity/settings/actions`, same section.)

**B. Merge queue and "branch must be up to date" (protects against two branches replacing the same SQL function).**
1. Open `https://github.com/Product-Velocity/app/settings/rules` and press **New ruleset**, then **New branch ruleset**.
2. Name it `main`. **Enforcement status:** Active. **Target branches:** Add target, **Include default branch**.
3. Tick **Require a pull request before merging**.
4. Tick **Require status checks to pass**, tick **Require branches to be up to date before merging**, press **Add checks** and add `check` (the CI job; it appears after one CI run).
5. Tick **Require merge queue**. Leave the defaults. (Available because the repository is public and owned by an organization; once it goes private it needs GitHub Enterprise Cloud, note it in `docs/14`.)
6. **Bypass list:** add **Repository admin** (so you can still fix things in an emergency). Press **Create**.
The CI workflow already listens for the merge queue (`merge_group`), so queued pull requests get their checks.

**C. Only if you did B: a token so the release workflow can still push to `main`.** The default workflow token cannot bypass a rule that requires pull requests.
1. Your profile picture, **Settings**, **Developer settings**, **Personal access tokens**, **Fine-grained tokens**, **Generate new token**. Name `release`, expiry 1 year, **Resource owner: Product-Velocity**, **Only select repositories: app**, **Repository permissions: Contents: Read and write**. Generate and copy it (an organization owner may have to approve it).
2. Open `https://github.com/Product-Velocity/app/settings/secrets/actions`, **New repository secret**, name `RELEASE_TOKEN`, paste the token, **Add secret**.
Release commits then appear under your name; because you are in the bypass list they go straight to `main`.

Optional: CODEOWNERS for `packages/db/migrations/` so a migration always gets a second look.

## Not done on purpose
No lock file or claim bot: the issue assignee and the open pull requests are the claim register. If it turns out agents still collide, a "claimed areas" file would be the next step.
