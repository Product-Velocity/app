import type { SupabaseClient } from "@supabase/supabase-js";

/** How many initiatives of each project are linked to a Jira issue (live ones: the Trash does not count). A read only; a failure counts as 0, never an error on the page. */
export async function countLinkedInitiatives(supabase: SupabaseClient, tenantId: string, projectIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (projectIds.length === 0) return out;
  try {
    const { data: items } = await supabase.from("items").select("id, home_project_id").eq("tenant_id", tenantId).in("home_project_id", projectIds).is("deleted_at", null).limit(5000);
    const rows = (items ?? []) as { id: string; home_project_id: string }[];
    if (rows.length === 0) return out;
    const { data: links } = await supabase.from("item_jira_links").select("item_id").eq("tenant_id", tenantId).in("item_id", rows.map((r) => r.id));
    const linked = new Set(((links ?? []) as { item_id: string }[]).map((l) => l.item_id));
    for (const r of rows) if (linked.has(r.id)) out.set(r.home_project_id, (out.get(r.home_project_id) ?? 0) + 1);
  } catch { /* leave empty */ }
  return out;
}
