import type { SupabaseClient } from "@supabase/supabase-js";

// "Next Sync would write Health on N initiatives": the initiatives of the project that are linked to the tracker for writing (link mode push) and have a
// value in each of the three fields. A read only; a missing table or column makes it 0, never an error on the settings page.
const KEYS = ["health", "initiative_status", "initiative_phase"] as const;
export async function countWithValues(supabase: SupabaseClient, tenantId: string, projectId: string, linkTable: "item_jira_links" | "item_github_links"): Promise<Record<string, number>> {
  const out: Record<string, number> = { health: 0, initiative_status: 0, initiative_phase: 0 };
  try {
    const { data: items } = await supabase.from("items").select("id, health, initiative_status, initiative_phase").eq("tenant_id", tenantId).eq("home_project_id", projectId).is("deleted_at", null).limit(2000);
    const rows = (items ?? []) as ({ id: string } & Record<string, string | null>)[];
    if (rows.length === 0) return out;
    const { data: links } = await supabase.from(linkTable).select("item_id").eq("tenant_id", tenantId).eq("mode", "push").in("item_id", rows.map((r) => r.id));
    const linked = new Set(((links ?? []) as { item_id: string }[]).map((l) => l.item_id));
    for (const r of rows) if (linked.has(r.id)) for (const k of KEYS) if (r[k]) out[k]!++;
  } catch { /* leave zeros */ }
  return out;
}

/** "16:42 UTC": when the fields were read, as text. */
export const readStamp = (d: Date = new Date()) => `at ${d.toISOString().slice(11, 16)} UTC`;
