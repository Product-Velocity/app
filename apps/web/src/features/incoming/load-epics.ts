import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyEpics, type EpicCoverageRow, type InitiativeRef, type SeenEpic } from "@/lib/atlassian/epic-coverage";

export type EpicCoverage = { rows: EpicCoverageRow[]; initiatives: InitiativeRef[]; projects: string[]; lastRead: string | null };

/** Everything the Epics tab shows, read as the signed-in person (row-level security): the ticked projects, the epics last read and what they are linked to. */
export async function loadEpicCoverage(supabase: SupabaseClient, tenantId: string): Promise<EpicCoverage> {
  const [{ data: ticked }, { data: seen }, { data: items }, { data: links }, { data: tree }, { data: requests }] = await Promise.all([
    supabase.from("jira_epic_projects").select("project_key").eq("tenant_id", tenantId).order("project_key"),
    supabase.from("jira_epics_seen").select("issue_key, project_key, title, status, status_category, parent_key, html_url, jira_updated_at, read_at").eq("tenant_id", tenantId).limit(5000),
    supabase.from("items").select("id, item_code, initiative_name").eq("tenant_id", tenantId).is("deleted_at", null).order("item_code").limit(3000),
    supabase.from("item_jira_links").select("item_id, issue_key").eq("tenant_id", tenantId).limit(5000),
    supabase.from("item_jira_tree").select("item_id, issue_key").eq("tenant_id", tenantId).eq("level", 1).limit(10000),
    supabase.from("item_jira_epic_requests").select("item_id, epic_key, state, last_error").eq("tenant_id", tenantId).limit(5000),
  ]);
  const epicRows = (seen ?? []) as { issue_key: string; project_key: string; title: string; status: string | null; status_category: string | null; parent_key: string | null; html_url: string | null; jira_updated_at: string | null; read_at: string }[];
  const epics: SeenEpic[] = epicRows.map((e) => ({ key: e.issue_key, project: e.project_key, title: e.title, status: e.status, category: e.status_category === "new" || e.status_category === "indeterminate" || e.status_category === "done" ? e.status_category : null, parentKey: e.parent_key, url: e.html_url, updatedAt: e.jira_updated_at }));
  const initiatives = ((items ?? []) as { id: string; item_code: string | null; initiative_name: string }[]).map((i) => ({ id: i.id, code: i.item_code ?? "", name: i.initiative_name }));
  const rows = classifyEpics({
    epics, items: initiatives,
    links: ((links ?? []) as { item_id: string; issue_key: string }[]).map((l) => ({ itemId: l.item_id, issueKey: l.issue_key })),
    tree: ((tree ?? []) as { item_id: string; issue_key: string }[]).map((t) => ({ itemId: t.item_id, issueKey: t.issue_key })),
    requests: ((requests ?? []) as { item_id: string; epic_key: string; state: "pending" | "linked" | "failed"; last_error: string | null }[]).map((r) => ({ itemId: r.item_id, epicKey: r.epic_key, state: r.state, error: r.last_error })),
  });
  const lastRead = epicRows.reduce<string | null>((m, e) => (!m || e.read_at > m ? e.read_at : m), null);
  return { rows, initiatives, projects: [...new Set(((ticked ?? []) as { project_key: string }[]).map((t) => t.project_key))], lastRead };
}
