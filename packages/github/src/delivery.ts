// Pull requests, CI and releases of an initiative (field dictionary: open_prs, merged_prs, ci_status, latest_release, repositories).
// Pure rules, so they are tested without GitHub. Everything here is read-only towards GitHub.

export type PrRef = { repo: string; number: number; state: "open" | "merged" | "closed" };
export type ReleaseRef = { repo: string; tag: string; name: string | null; publishedAt: string };

const key = (p: { repo: string; number: number }) => `${p.repo.toLowerCase()}#${p.number}`;

/** Open and merged pull requests linked to the initiative's issues. A pull request linked from several issues counts once; a closed one that was not merged counts as neither. */
export function countPullRequests(prs: readonly PrRef[]): { open: number; merged: number } {
  const seen = new Map<string, PrRef["state"]>();
  for (const p of prs) {
    const prev = seen.get(key(p));
    // merged beats closed beats open if two answers disagree (the issue was read at slightly different times)
    const rank = { open: 0, closed: 1, merged: 2 } as const;
    if (!prev || rank[p.state] > rank[prev]) seen.set(key(p), p.state);
  }
  let open = 0, merged = 0;
  for (const s of seen.values()) { if (s === "open") open++; else if (s === "merged") merged++; }
  return { open, merged };
}

/**
 * The status of the checks on the default branch of the primary repository, in the dictionary's three words. GitHub's rollup states:
 * SUCCESS is Passing; FAILURE and ERROR are Failing; no checks at all is None; PENDING and EXPECTED mean "still running": null, which
 * leaves the value that was shown before (a run in progress is neither passing nor failing).
 */
export function ciValue(rollup: string | null | undefined): "Passing" | "Failing" | "None" | null {
  if (rollup === null || rollup === undefined) return "None";
  if (rollup === "SUCCESS") return "Passing";
  if (rollup === "FAILURE" || rollup === "ERROR") return "Failing";
  return null;
}

/** The latest release in the initiative's repositories since the item started (when it did not start yet, the latest of all). */
export function pickLatestRelease(releases: readonly ReleaseRef[], since: string | null | undefined): ReleaseRef | null {
  const floor = since ? Date.parse(since) : NaN;
  let best: { r: ReleaseRef; at: number } | null = null;
  for (const r of releases) {
    const at = Date.parse(r.publishedAt);
    if (Number.isNaN(at) || (!Number.isNaN(floor) && at < floor)) continue;
    if (!best || at > best.at) best = { r, at };
  }
  return best?.r ?? null;
}

/** "v1.4.0 · 2026-10-20", with the repository in front when the initiative spans several. */
export function formatRelease(r: ReleaseRef, withRepo = false): string {
  const label = (r.tag || r.name || "release").slice(0, 100);
  return `${withRepo ? `${r.repo} ` : ""}${label} · ${r.publishedAt.slice(0, 10)}`.slice(0, 200);
}

/** The repositories that contain the initiative's issues (its own and its children), once each, sorted, as one text. */
export function repositoriesText(repos: readonly string[]): string {
  const byLower = new Map<string, string>();
  for (const r of repos) if (r && !byLower.has(r.toLowerCase())) byLower.set(r.toLowerCase(), r);
  return [...byLower.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).join(", ").slice(0, 500);
}
