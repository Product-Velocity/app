import { MARKER, mergeBody, type TrackingIssue } from "./outbound";
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
 * - Outside the managed block nothing is touched, and labels are only ever added.
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
