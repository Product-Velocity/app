import "server-only";
import type { SourceControl } from "@pv/github";
import { githubCatalogGroups, type TrackerCatalog } from "@/lib/tracker-fields/catalog";

const msg = (e: unknown) => (e instanceof Error ? e.message : "unknown reason").slice(0, 200);

/**
 * Reads what a GitHub connection can see (decision 2026-11-03-tracker-field-config): the organisation's issue fields, the fields of the linked
 * Projects v2 boards, the labels and milestones of the given repositories (at most 3) and the organisation's issue types. Reads only; a part that
 * fails is reported in its own group.
 */
export async function readGithubCatalog(sc: SourceControl, installationId: number, organisation: string, opts: { boards: { id: string; title: string }[]; repos: string[] }): Promise<TrackerCatalog> {
  const repos = opts.repos.slice(0, 3);
  const [issueFields, types, boards, labels, milestones] = await Promise.all([
    sc.listIssueFields(installationId, organisation).then((v) => ({ v, e: null as string | null }), (e) => ({ v: null, e: `Issue fields could not be read just now: ${msg(e)}.` })),
    sc.listIssueTypes(installationId, organisation).catch(() => null),
    Promise.all(opts.boards.map((b) => sc.getBoardFields(installationId, b.id).then((fields) => ({ title: b.title, fields }), (e) => ({ title: b.title, fields: null, error: `This board could not be read just now: ${msg(e)}.` })))),
    Promise.all(repos.map((repo) => sc.listLabels(installationId, repo).then((l) => ({ repo, labels: l }), (e) => ({ repo, labels: [], error: `Labels could not be read just now: ${msg(e)}.` })))),
    Promise.all(repos.map((repo) => sc.listMilestones(installationId, repo).then((m) => ({ repo, milestones: m }), (e) => ({ repo, milestones: [], error: `Milestones could not be read just now: ${msg(e)}.` })))),
  ]);
  return { tracker: "github", scope: organisation, readAt: new Date().toISOString(), groups: githubCatalogGroups({ issueFields: issueFields.v, issueFieldsError: issueFields.e, boards, labels, issueTypes: types, milestones }) };
}
