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
1. **Merge queue on `main`** (Settings, Branches, branch protection rule for `main`, "Require merge queue"), and "Require branches to be up to date before merging". CI then runs on the merged result of each PR, which is the only guard against the semantic conflicts in rule 3.
2. **Let the release workflow push to `main`:** Settings, Actions, General, Workflow permissions: "Read and write permissions". If `main` requires pull requests, allow `github-actions[bot]` to bypass that rule (or the release commit is refused and the fragment stays in place; nothing is lost and the next merge retries it).
3. Optional: CODEOWNERS for `packages/db/migrations/` so a migration always gets a second look.

## Not done on purpose
No lock file or claim bot: the issue assignee and the open pull requests are the claim register. If it turns out agents still collide, a "claimed areas" file would be the next step.
