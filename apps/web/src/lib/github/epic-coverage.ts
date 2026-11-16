// Epics coverage, GitHub side (issue #465): for each open parent issue read from the ticked repositories, is it linked to a Product Velocity initiative?
// Pure: the rules live in lib/atlassian/epic-coverage.ts (classifyEpics, shared with Jira); this only turns GitHub's repository-and-number pairs into the
// keys it matches on, without regard to case (repository names are not case sensitive). Nothing here talks to GitHub.
import { classifyEpics, githubIssueKey, type EpicCoverageRow, type InitiativeRef, type SeenEpic } from "@/lib/atlassian/epic-coverage";

export type SeenParentIssue = { repo: string; number: number; title: string; subIssues: number; parent: { repo: string; number: number } | null; url: string | null; updatedAt: string | null };
export type GithubCoverageInput = {
  seen: SeenParentIssue[];
  items: InitiativeRef[];
  /** the issue each initiative is linked to (its tracking issue, pushed or followed) */
  links: { itemId: string; repo: string; number: number }[];
  /** the epics (first level) already read under a linked issue */
  tree: { itemId: string; repo: string; number: number }[];
};

const lower = (repo: string, n: number) => githubIssueKey(repo, n).toLowerCase();

export function classifyGithubEpics(input: GithubCoverageInput): EpicCoverageRow[] {
  const shown = new Map<string, string>(); // lower-case key -> the key as GitHub spells it
  const epics: SeenEpic[] = input.seen.map((e) => {
    const k = lower(e.repo, e.number);
    shown.set(k, githubIssueKey(e.repo, e.number));
    if (e.parent) shown.set(lower(e.parent.repo, e.parent.number), githubIssueKey(e.parent.repo, e.parent.number));
    return { key: k, project: e.repo, title: e.title, status: `Open, ${e.subIssues} sub-issue${e.subIssues === 1 ? "" : "s"}`, category: null, parentKey: e.parent ? lower(e.parent.repo, e.parent.number) : null, url: e.url, updatedAt: e.updatedAt };
  });
  return classifyEpics({
    epics, items: input.items,
    links: input.links.map((l) => ({ itemId: l.itemId, issueKey: lower(l.repo, l.number) })),
    tree: input.tree.map((t) => ({ itemId: t.itemId, issueKey: lower(t.repo, t.number) })),
    requests: [], // adding sub-issues to an initiative's parent issue is #458; until it exists nothing is "Waiting for Sync"
  }).map((r) => ({ ...r, key: shown.get(r.key) ?? r.key, note: r.state === "initiative_not_in_pv" && r.note ? (shown.get(r.note) ?? r.note) : r.note }));
}
