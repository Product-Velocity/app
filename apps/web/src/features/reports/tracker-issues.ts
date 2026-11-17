import type { SupabaseClient } from "@supabase/supabase-js";
import type { TrackerRef } from "@pv/domain";

/**
 * The tracker issue each initiative is linked to (Jira epic or GitHub issue), read through the member's own access: key, link and, for Jira, the issue's name.
 * Shared by the Changes report and the Leadership update, so both link to the same ticket.
 */
export async function loadTrackerIssues(client: SupabaseClient, tenantId: string, itemIds: string[]): Promise<Map<string, TrackerRef>> {
  const out = new Map<string, TrackerRef>();
  const ids = [...new Set(itemIds)];
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    const [jira, gh] = await Promise.all([
      client.from("item_jira_links").select("item_id, issue_key, html_url").eq("tenant_id", tenantId).in("item_id", chunk),
      client.from("item_github_links").select("item_id, repo_full_name, issue_number, html_url").eq("tenant_id", tenantId).in("item_id", chunk).not("issue_number", "is", null),
    ]);
    if (jira.error) throw new Error(jira.error.message);
    if (gh.error) throw new Error(gh.error.message);
    const jl = (jira.data ?? []) as { item_id: string; issue_key: string; html_url: string | null }[];
    const titles = new Map<string, string>();
    if (jl.length > 0) {
      const t = await client.from("jira_issues").select("issue_key, title").eq("tenant_id", tenantId).in("issue_key", jl.map((l) => l.issue_key));
      if (!t.error) for (const r of (t.data ?? []) as { issue_key: string; title: string }[]) titles.set(r.issue_key, r.title);
    }
    for (const l of jl) out.set(l.item_id, { tracker: "Jira", key: l.issue_key, title: titles.get(l.issue_key) ?? null, url: l.html_url });
    for (const l of (gh.data ?? []) as { item_id: string; repo_full_name: string; issue_number: number; html_url: string | null }[]) if (!out.has(l.item_id)) out.set(l.item_id, { tracker: "GitHub", key: `${l.repo_full_name}#${l.issue_number}`, title: null, url: l.html_url });
  }
  return out;
}
