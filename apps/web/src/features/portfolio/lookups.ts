import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lookups } from "./types";

/** What the grid and the item panel need besides the items: projects, people, Initiative Groups and teams of the workspace. */
export async function loadLookups(supabase: SupabaseClient, tenantId: string): Promise<Lookups> {
  const [projects, groups, teams, people] = await Promise.all([
    supabase.from("projects").select("id, name").eq("tenant_id", tenantId).order("name"),
    supabase.from("item_groups").select("name").eq("tenant_id", tenantId).order("name"),
    supabase.from("teams").select("id, name").eq("tenant_id", tenantId).order("name"),
    supabase.rpc("tenant_directory", { p_tenant: tenantId }),
  ]);
  return {
    projects: (projects.data ?? []) as { id: string; name: string }[],
    members: ((people.data ?? []) as { user_id: string; email: string }[]).map((p) => ({ user_id: p.user_id, email: p.email })),
    groups: ((groups.data ?? []) as { name: string }[]).map((g) => g.name),
    teams: (teams.data ?? []) as { id: string; name: string }[],
  };
}
