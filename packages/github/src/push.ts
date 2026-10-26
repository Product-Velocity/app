import { MARKER, mergeBody, OWNED_LABEL_PREFIX, type TrackingIssue } from "./outbound";
import { GitHubError, type IssueRef, type SourceControl } from "./source-control";

export type ExistingLink = { issueNumber: number | null; lastPushedHash: string | null };
export type PushResult =
  | { kind: "unchanged" }
  /** The linked issue is gone (deleted or transferred). Nothing is recreated: a person decides. */
  | { kind: "missing" }
  | { kind: "created" | "updated"; issue: IssueRef; hash: string };

export const LABEL_COLOUR = "3347D9";

/**
 * Creates or updates the one tracking issue of an initiative.
 * - Idempotent: an unchanged item sends nothing; a create whose answer was lost is found again by the marker in the body
 *   instead of being created twice.
 * - Outside the managed block nothing is touched. Labels: the ones the item should have are added; labels in the app's own `pv:`
 *   namespace that it should no longer have are removed; labels outside `pv:` (people's, other tools') are never touched.
 */
export async function pushTrackingIssue(sc: SourceControl, installationId: number, repo: string, itemId: string, built: TrackingIssue, existing: ExistingLink | null): Promise<PushResult> {
  let issue: IssueRef | null = null;
  if (existing?.issueNumber) {
    if (existing.lastPushedHash === built.hash) return { kind: "unchanged" };
    issue = await sc.getIssue(installationId, repo, existing.issueNumber);
    if (!issue) return { kind: "missing" };
  } else {
    issue = await sc.findIssueByMarker(installationId, repo, MARKER(itemId));
  }

  await sc.ensureLabels(installationId, repo, built.labels.map((name) => ({ name, color: LABEL_COLOUR, description: "Managed by Product Velocity" })));
  if (!issue) {
    const created = await sc.createIssue(installationId, repo, { title: built.title, body: built.block, labels: built.labels });
    return { kind: "created", issue: created, hash: built.hash };
  }
  const updated = await sc.updateIssue(installationId, repo, issue.number, { title: built.title, body: mergeBody(issue.body, built.block) });
  await sc.addLabels(installationId, repo, issue.number, built.labels);
  for (const stale of (issue.labels ?? []).filter((l) => l.startsWith(OWNED_LABEL_PREFIX) && !built.labels.includes(l))) await sc.removeLabel(installationId, repo, issue.number, stale);
  return { kind: "updated", issue: updated, hash: built.hash };
}

/** A short message safe to show and store: never the response body, never a token. */
export function describePushError(e: unknown): string {
  if (e instanceof GitHubError) {
    if (e.status === 401) return "GitHub did not accept the app's credentials. Run the connection test.";
    if (e.status === 403 || e.status === 429) return e.retryAfterSeconds ? `GitHub is busy, try again in about ${e.retryAfterSeconds} seconds.` : "GitHub refused the request (the app may lack the Issues permission). Run the connection test.";
    if (e.status === 404) return "GitHub could not find the repository. Check the project's default repository.";
    if (e.status === 410) return "Issues are disabled in that repository.";
    return `GitHub refused the request (${e.status}).`;
  }
  return "The push did not finish. Try again.";
}

export type PlanLink = { mode: "push" | "follow"; repo: string; issueNumber: number | null; syncState: string; lastPushedHash: string | null };
export type PlanDecision = { repo: string | null; action: "create" | "update" | "unchanged" | "blocked"; reason?: string };

/** What a push would do for one item. Pure, so the rules can be tested without GitHub or a database. */
export function planAction(a: { link: PlanLink | null; defaultRepo: string | null; activeRepos: ReadonlySet<string>; /** lower-case names of repositories marked read-only */ readOnlyRepos?: ReadonlySet<string>; hash: string; projectName: string }): PlanDecision {
  const { link } = a;
  const repo = link?.repo ?? a.defaultRepo;
  if (link?.mode === "follow") return { repo, action: "blocked", reason: `It follows ${link.issueNumber ? `issue #${link.issueNumber}` : "an existing GitHub issue"} read-only: pushing to it is switched off.` };
  if (repo && a.readOnlyRepos?.has(repo.toLowerCase())) return { repo, action: "blocked", reason: `${repo} is marked read-only in Settings > GitHub: the app never writes to it.` };
  if (!repo) return { repo, action: "blocked", reason: `Choose a default repository for ${a.projectName || "the project"} in Settings > GitHub first.` };
  if (!link && !a.activeRepos.has(repo.toLowerCase())) return { repo, action: "blocked", reason: `${repo} is no longer available through the GitHub connection.` };
  if (link?.issueNumber && link.syncState === "synced" && link.lastPushedHash === a.hash) return { repo, action: "unchanged" };
  return { repo, action: link?.issueNumber ? "update" : "create" };
}
