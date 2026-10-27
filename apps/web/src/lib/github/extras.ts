import "server-only";
import { ciValue, countPullRequests, formatRelease, pickLatestRelease, repositoriesText, type ReleaseRef, type SourceControl } from "@pv/github";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/** One read of a repository's checks or releases is shared by every initiative of the same pass. */
export type ExtrasCache = { ci: Map<string, Promise<string | null>>; releases: Map<string, Promise<ReleaseRef[]>> };
export const newExtrasCache = (): ExtrasCache => ({ ci: new Map(), releases: new Map() });

const short = (e: unknown) => (e instanceof Error ? e.message : "unknown error").slice(0, 200);
const MAX_RELEASE_REPOS = 10;

/**
 * Works out, from GitHub, the pull requests (open, merged), the checks on the default branch of the primary repository, the latest release
 * since the item started and the repositories of one linked initiative, and stores them. Read-only towards GitHub. If any read fails
 * nothing is stored (the values shown stay as they were and the next pass tries again); it never throws into a delivery.
 */
export async function refreshExtras(admin: Admin, sc: SourceControl, installationId: number, connectionId: string, itemId: string, cache: ExtrasCache = newExtrasCache()): Promise<boolean> {
  try {
    const { data: link } = await admin.from("item_github_links").select("tenant_id, repo_full_name, issue_number").eq("connection_id", connectionId).eq("item_id", itemId).maybeSingle();
    if (!link || link.issue_number === null) return false;
    const tenantId = link.tenant_id as string; // every later read is scoped to the workspace of the link
    const [{ data: tree }, { data: item }] = await Promise.all([
      admin.from("item_issue_tree").select("repo_full_name, issue_number").eq("tenant_id", tenantId).eq("item_id", itemId),
      admin.from("items").select("start_building").eq("tenant_id", tenantId).eq("id", itemId).maybeSingle(),
    ]);
    const issues = [{ repo: link.repo_full_name as string, number: link.issue_number as number }, ...((tree ?? []) as { repo_full_name: string; issue_number: number }[]).map((t) => ({ repo: t.repo_full_name, number: t.issue_number }))];
    const repos = repositoriesText(issues.map((i) => i.repo)).split(", ").filter(Boolean);
    const primary = link.repo_full_name as string;

    const prs = await sc.listLinkedPullRequests(installationId, issues);
    const { open, merged } = countPullRequests(prs);
    const rollup = await cached(cache.ci, primary.toLowerCase(), () => sc.getDefaultBranchRollup(installationId, primary));
    const releases = (await Promise.all(repos.slice(0, MAX_RELEASE_REPOS).map((r) => cached(cache.releases, r.toLowerCase(), () => sc.listReleases(installationId, r))))).flat();
    const latest = pickLatestRelease(releases, (item?.start_building as string | null | undefined) ?? null);

    const { data, error } = await admin.rpc("github_apply_extras", {
      p_connection: connectionId, p_item: itemId, p_open: open, p_merged: merged, p_ci: ciValue(rollup),
      p_release: latest ? formatRelease(latest, repos.length > 1) : null, p_repos: repositoriesText(issues.map((i) => i.repo)),
    });
    if (error) throw new Error(error.message);
    return data === true;
  } catch (e) {
    console.error(JSON.stringify({ github: "extras", error: short(e) }));
    return false;
  }
}

function cached<T>(map: Map<string, Promise<T>>, key: string, read: () => Promise<T>): Promise<T> {
  let p = map.get(key);
  if (!p) { p = read(); map.set(key, p); p.catch(() => map.delete(key)); } // a failed read is not remembered
  return p;
}
