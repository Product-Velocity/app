import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { readIssuesByKey, type JiraIssueRow, type SearchPage } from "./read-issues";
import { readJiraLink, type LinkToRead } from "./read-jira";
import { refreshLinkedStatuses, type RefreshDeps, type RefreshSummary } from "./refresh-linked";
import { jiraGet } from "./server";

// Server side of the refresh of linked initiatives (issue #67, #71): wires the pure core to Jira (jiraGet) and to the database (service
// role, source "system"). Reads Jira only; nothing is written to Jira. A connection that needs a new sign-in throws ReconnectNeeded.

const rpcRow = (r: JiraIssueRow) => ({ key: r.key, id: r.id, title: r.title, type: r.type, level: r.level, labels: r.labels, status: r.status, category: r.category, parent: r.parent, url: r.url, updated: r.updated });
const MAX_LIGHT = 500;

function depsFor(link: LinkToRead): RefreshDeps {
  const admin = createAdminClient({ via: "system" });
  return {
    getPage: (path) => jiraGet<SearchPage>(link.connection_id, link.site_id, path),
    async upsert(rows) {
      const { error } = await admin.rpc("jira_upsert_issues", { p_link: link.id, p_rows: rows.map(rpcRow) });
      if (error) throw new Error("Could not save the issues");
    },
    async apply(rows) {
      const { data, error } = await admin.rpc("jira_apply_statuses", { p_connection: link.connection_id, p_site: link.site_id, p_rows: rows });
      if (error) throw new Error("Could not apply the Jira status");
      return (data ?? []) as Awaited<ReturnType<RefreshDeps["apply"]>>;
    },
  };
}

/** The initiatives linked to issues of this Jira project (optionally only some initiatives). */
async function linkedIssues(link: LinkToRead, itemIds?: string[]) {
  const admin = createAdminClient({ via: "system" });
  let q = admin.from("item_jira_links").select("item_id, issue_key").eq("tenant_id", link.tenant_id).eq("connection_id", link.connection_id).eq("site_id", link.site_id);
  if (itemIds) q = q.in("item_id", itemIds);
  const { data, error } = await q;
  if (error) throw new Error("Could not read the linked initiatives");
  return ((data ?? []) as { item_id: string; issue_key: string }[]).filter((l) => l.issue_key.startsWith(`${link.jira_project_key}-`));
}

/** Reads the linked issues of one Jira project and applies their status to the initiatives. `known` = rows just read, so they are not read twice. */
export async function applyLinkedStatuses(link: LinkToRead, siteUrl: string, opts: { itemIds?: string[]; known?: Map<string, JiraIssueRow> } = {}): Promise<RefreshSummary> {
  return refreshLinkedStatuses(depsFor(link), await linkedIssues(link, opts.itemIds), siteUrl, opts.known);
}

/**
 * Light records that were open at the last read but were not in this one (they may have become Done, moved or been deleted): read by key
 * so the Incoming list and the counts stop showing them as open. Returns how many were read.
 */
export async function refreshStaleLightRecords(link: LinkToRead, siteUrl: string, seen: Set<string>, skip: Set<string> = new Set()): Promise<number> {
  const admin = createAdminClient({ via: "system" });
  const { data, error } = await admin.from("jira_issues").select("issue_key").eq("tenant_id", link.tenant_id).eq("connection_id", link.connection_id).eq("site_id", link.site_id).eq("jira_project_key", link.jira_project_key).or("status_category.is.null,status_category.neq.done").order("updated_at", { ascending: true }).limit(MAX_LIGHT);
  if (error) throw new Error("Could not read the issue list");
  const keys = ((data ?? []) as { issue_key: string }[]).map((r) => r.issue_key).filter((k) => !seen.has(k) && !skip.has(k));
  if (keys.length === 0) return 0;
  const deps = depsFor(link);
  const { rows } = await readIssuesByKey(deps.getPage, keys, siteUrl);
  if (rows.length > 0) await deps.upsert(rows);
  return rows.length;
}

export type FullRefresh = { total: number; light: number; linked: RefreshSummary };

/**
 * The whole read of one linked Jira project, used by the daily check: the open work, then what became Done since, then the status of every
 * linked initiative. Throws (after readJiraLink recorded the reason) when Jira cannot be read.
 */
export async function refreshJiraProject(link: LinkToRead, siteUrl: string): Promise<FullRefresh> {
  const read = await readJiraLink(link, siteUrl);
  const seen = new Set(read.rows.map((r) => r.key));
  const links = await linkedIssues(link);
  const linkedKeys = new Set(links.map((l) => l.issue_key));
  const light = await refreshStaleLightRecords(link, siteUrl, seen, linkedKeys);
  const linked = await refreshLinkedStatuses(depsFor(link), links, siteUrl, new Map(read.rows.map((r) => [r.key, r])));
  return { total: read.total, light, linked };
}
