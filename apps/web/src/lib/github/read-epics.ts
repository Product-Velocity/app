import "server-only";
import type { SourceControl } from "@pv/github";
import { createAdminClient } from "@/lib/supabase/admin";

export type GithubEpicsRead = { repos: number; epics: number; failed: number; truncated: boolean };

/** Pages of 100 open issues read per repository for the Epics list; a repository with more open issues than this is read in part and says so. */
const PAGES = 10;

/**
 * Reads the open parent issues (open issues with sub-issues) of the repositories ticked under "Repositories to check for epics"
 * (github_epic_repos) into github_epics_seen, one repository at a time, so one repository that cannot be read leaves the others as they were.
 * Reads GitHub only; nothing is written to GitHub. A read cut at the page limit never deletes epics it did not reach (it counts as not read).
 */
export async function readTickedGithubEpics(tenantId: string, sc: SourceControl): Promise<GithubEpicsRead> {
  const admin = createAdminClient({ via: "system" });
  const [{ data: ticked }, { data: conns }] = await Promise.all([
    admin.from("github_epic_repos").select("connection_id, repo_full_name").eq("tenant_id", tenantId).order("repo_full_name"),
    admin.from("github_connections").select("id, installation_id").eq("tenant_id", tenantId).eq("state", "connected"),
  ]);
  const out: GithubEpicsRead = { repos: 0, epics: 0, failed: 0, truncated: false };
  for (const t of (ticked ?? []) as { connection_id: string; repo_full_name: string }[]) {
    const conn = ((conns ?? []) as { id: string; installation_id: number | null }[]).find((c) => c.id === t.connection_id);
    if (!conn || conn.installation_id === null) { out.failed++; continue; }
    try {
      const { issues, truncated } = await sc.listOpenParentIssues(conn.installation_id, t.repo_full_name, { maxPages: PAGES });
      if (truncated) { out.truncated = true; out.failed++; continue; }
      const { error } = await admin.rpc("github_replace_epics", {
        p_tenant: tenantId, p_connection: t.connection_id, p_repo: t.repo_full_name,
        p_rows: issues.map((i) => ({ number: i.number, title: i.title, type: i.issueType, subs: i.subIssuesTotal, parent_repo: i.parent?.repo ?? null, parent_number: i.parent?.number ?? null, url: i.htmlUrl, updated: i.updatedAt })),
      });
      if (error) { out.failed++; continue; }
      out.repos++;
      out.epics += issues.length;
    } catch (e) {
      out.failed++;
      console.error(JSON.stringify({ github: "epics-read", error: e instanceof Error ? e.message.slice(0, 120) : "unknown" }));
    }
  }
  return out;
}
