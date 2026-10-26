import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canLinkFilesInto } from "@pv/domain";
import { buildTrackingIssue, describePushError, planAction, pushTrackingIssue, type PlanLink, type SourceControl } from "@pv/github";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { ConnectionRow } from "./server";
import { shareUrl } from "@/lib/files/serve";
import { refreshTree } from "./sync";
import { PUSH_LIMIT, type PlanItem, type PushItemResult } from "./push-types";

type Admin = ReturnType<typeof createAdminClient>;
type Link = { item_id: string; mode: "push" | "follow"; repo_full_name: string; issue_number: number | null; html_url: string | null; sync_state: string; last_pushed_hash: string | null };
type Row = { id: string; item_code: string; initiative_name: string; summary: string | null; description: string | null; hypothesis: string | null; moscow: string | null; stack_rank: number; home_project_id: string };

type SharedFile = { item_id: string; name: string; share_token: string };
const sharedFilesByItem = (rows: SharedFile[], appUrl: string) => {
  const m = new Map<string, { label: string; url: string }[]>();
  for (const r of rows) m.set(r.item_id, [...(m.get(r.item_id) ?? []), { label: r.name, url: shareUrl(appUrl, r.share_token, r.name) }]);
  return m;
};

const blockedItem = (id: string, reason: string, over: Partial<PlanItem> = {}): PlanItem => ({ id, code: "", name: "", project: "", repo: null, action: "blocked", title: "", labels: [], block: "", issueNumber: null, issueUrl: null, reason, ...over });

/**
 * Works out what a push would do for each item, without writing anything. Only the allowlisted item columns are
 * selected (never `select *`), through the signed-in user's own client, so RLS applies.
 */
export async function planPush(supabase: SupabaseClient, tenantId: string, appUrl: string, connection: ConnectionRow, ids: string[]): Promise<PlanItem[]> {
  const unique = [...new Set(ids)].slice(0, PUSH_LIMIT);
  const [items, projects, repos, links, artifacts, sharedFiles] = await Promise.all([
    supabase.from("items").select("id, item_code, initiative_name, summary, description, hypothesis, moscow, stack_rank, home_project_id").eq("tenant_id", tenantId).is("deleted_at", null).in("id", unique),
    supabase.from("projects").select("id, name, default_repo, tracker").eq("tenant_id", tenantId),
    supabase.from("github_repositories").select("full_name, access, is_private").eq("tenant_id", tenantId).eq("connection_id", connection.id).is("removed_at", null),
    supabase.from("item_github_links").select("item_id, mode, repo_full_name, issue_number, html_url, sync_state, last_pushed_hash").eq("tenant_id", tenantId).in("item_id", unique),
    supabase.from("item_links").select("item_id, label, url").eq("tenant_id", tenantId).in("item_id", unique),
    supabase.from("item_files").select("item_id, name, share_token").eq("tenant_id", tenantId).in("item_id", unique).not("share_token", "is", null).order("created_at"),
  ]);
  const rowById = new Map(((items.data ?? []) as Row[]).map((r) => [r.id, r]));
  const projectById = new Map(((projects.data ?? []) as { id: string; name: string; default_repo: string | null; tracker: string | null }[]).map((p) => [p.id, p]));
  const repoRows = (repos.data ?? []) as { full_name: string; access: string; is_private: boolean | null }[];
  const privateRepos = new Set(repoRows.filter((r) => canLinkFilesInto(r.is_private)).map((r) => r.full_name.toLowerCase()));
  const activeRepos = new Set(repoRows.map((r) => r.full_name.toLowerCase()));
  const readOnlyRepos = new Set(repoRows.filter((r) => r.access === "read_only").map((r) => r.full_name.toLowerCase()));
  const linkByItem = new Map(((links.data ?? []) as Link[]).map((l) => [l.item_id, l]));
  const artifactsByItem = new Map<string, { label: string; url: string }[]>();
  for (const a of (artifacts.data ?? []) as { item_id: string; label: string; url: string }[]) artifactsByItem.set(a.item_id, [...(artifactsByItem.get(a.item_id) ?? []), { label: a.label, url: a.url }]);

  const filesByItem = sharedFilesByItem((sharedFiles.data ?? []) as SharedFile[], appUrl);

  return unique.map((id) => {
    const row = rowById.get(id);
    if (!row) return blockedItem(id, "This initiative no longer exists or you cannot see it.");
    const project = projectById.get(row.home_project_id);
    const link = linkByItem.get(id);
    if (project?.tracker && project.tracker !== "github") return blockedItem(id, `${project.name} is linked to ${project.tracker === "jira" ? "Jira" : project.tracker}: a project has one tracker, so its initiatives are not sent to GitHub.`, { code: row.item_code, name: row.initiative_name, project: project.name });
    const planLink: PlanLink | null = link ? { mode: link.mode, repo: link.repo_full_name, issueNumber: link.issue_number, syncState: link.sync_state, lastPushedHash: link.last_pushed_hash } : null;
    const itemFiles = filesByItem.get(id) ?? [];
    const target = (link?.repo_full_name ?? project?.default_repo ?? "").toLowerCase();
    const filesOk = privateRepos.has(target);
    const built = buildTrackingIssue({ item: row, itemId: id, projectName: project?.name ?? "", appUrl, artifacts: artifactsByItem.get(id) ?? [], files: filesOk ? itemFiles : [] });
    const d = planAction({ link: planLink, defaultRepo: project?.default_repo ?? null, activeRepos, readOnlyRepos, hash: built.hash, projectName: project?.name ?? "" });
    const withheld = itemFiles.length > 0 && !filesOk ? { filesNote: `${itemFiles.length === 1 ? "A shared file link was" : `${itemFiles.length} shared file links were`} left out: ${d.repo ?? "this repository"} is public (or its visibility is unknown), and anyone could open the links. Files are only linked in private repositories.` } : {};
    return { id, code: row.item_code, name: row.initiative_name, project: project?.name ?? "", repo: d.repo, action: d.action, title: built.title, labels: built.labels, block: built.block, issueNumber: link?.issue_number ?? null, issueUrl: link?.html_url ?? null, ...(d.reason ? { reason: d.reason } : {}), ...withheld };
  });
}

/** Sends the confirmed plan. Per item: push, then record the link on behalf of the person who confirmed. One item failing never stops the others. */
export async function executePush(opts: { supabase: SupabaseClient; admin: Admin; sc: SourceControl; connection: ConnectionRow; tenantId: string; actor: string; appUrl: string; ids: string[] }): Promise<PushItemResult[]> {
  const plan = await planPush(opts.supabase, opts.tenantId, opts.appUrl, opts.connection, opts.ids);
  const installationId = opts.connection.installation_id!;
  const [links, artifacts, items, sharedFiles, repoPrivacy] = await Promise.all([
    opts.supabase.from("item_github_links").select("item_id, issue_number, last_pushed_hash").eq("tenant_id", opts.tenantId).in("item_id", plan.map((p) => p.id)),
    opts.supabase.from("item_links").select("item_id, label, url").eq("tenant_id", opts.tenantId).in("item_id", plan.map((p) => p.id)),
    opts.supabase.from("items").select("id, item_code, initiative_name, summary, description, hypothesis, moscow, stack_rank").eq("tenant_id", opts.tenantId).in("id", plan.map((p) => p.id)),
    opts.supabase.from("item_files").select("item_id, name, share_token").eq("tenant_id", opts.tenantId).in("item_id", plan.map((p) => p.id)).not("share_token", "is", null).order("created_at"),
    opts.supabase.from("github_repositories").select("full_name, is_private").eq("tenant_id", opts.tenantId).eq("connection_id", opts.connection.id).is("removed_at", null),
  ]);
  const filesBy = sharedFilesByItem((sharedFiles.data ?? []) as SharedFile[], opts.appUrl);
  const privateRepos = new Set(((repoPrivacy.data ?? []) as { full_name: string; is_private: boolean | null }[]).filter((r) => canLinkFilesInto(r.is_private)).map((r) => r.full_name.toLowerCase()));
  const linkBy = new Map(((links.data ?? []) as { item_id: string; issue_number: number | null; last_pushed_hash: string | null }[]).map((l) => [l.item_id, l]));
  const itemBy = new Map(((items.data ?? []) as Row[]).map((r) => [r.id, r]));

  const results: PushItemResult[] = [];
  for (const p of plan) {
    const code = p.code;
    if (p.action === "blocked") { results.push({ id: p.id, code, outcome: "blocked", message: p.reason }); continue; }
    if (p.action === "unchanged") { results.push({ id: p.id, code, outcome: "unchanged", issueNumber: p.issueNumber ?? undefined, issueUrl: p.issueUrl ?? undefined }); continue; }
    const row = itemBy.get(p.id)!;
    const built = buildTrackingIssue({ item: row, itemId: p.id, projectName: p.project, appUrl: opts.appUrl, artifacts: ((artifacts.data ?? []) as { item_id: string; label: string; url: string }[]).filter((a) => a.item_id === p.id), files: p.repo && privateRepos.has(p.repo.toLowerCase()) ? filesBy.get(p.id) ?? [] : [] });
    const record = (state: "synced" | "error", extra: { number?: number; id?: number; node?: string; url?: string; error?: string }) =>
      opts.admin.rpc("github_record_push", { p_actor: opts.actor, p_item: p.id, p_connection: opts.connection.id, p_repo: p.repo, p_number: extra.number ?? null, p_issue_id: extra.id ?? null, p_node_id: extra.node ?? null, p_url: extra.url ?? null, p_hash: built.hash, p_state: state, p_error: extra.error ?? null });
    try {
      const r = await pushTrackingIssue(opts.sc, installationId, p.repo!, p.id, built, linkBy.get(p.id) ? { issueNumber: linkBy.get(p.id)!.issue_number, lastPushedHash: linkBy.get(p.id)!.last_pushed_hash } : null);
      if (r.kind === "missing") {
        await record("error", { error: "The GitHub issue no longer exists. Unlink it or create a new one." });
        results.push({ id: p.id, code, outcome: "missing", message: "The linked GitHub issue no longer exists (deleted or moved). Nothing was recreated." });
      } else if (r.kind === "unchanged") {
        results.push({ id: p.id, code, outcome: "unchanged" });
      } else {
        const saved = await record("synced", { number: r.issue.number, id: r.issue.id, node: r.issue.nodeId, url: r.issue.htmlUrl });
        if (!saved.error) await refreshTree(opts.admin, opts.sc, installationId, opts.connection.id, { item_id: p.id, repo: p.repo!, number: r.issue.number }); // starts the Traditional breakdown route
        results.push({ id: p.id, code, outcome: r.kind, issueNumber: r.issue.number, issueUrl: r.issue.htmlUrl, ...(saved.error ? { message: "Sent to GitHub, but the link could not be saved. Pushing again will find the issue." } : {}) });
      }
    } catch (e) {
      const message = describePushError(e);
      await record("error", { error: message });
      results.push({ id: p.id, code, outcome: "error", message });
    }
  }
  return results;
}
