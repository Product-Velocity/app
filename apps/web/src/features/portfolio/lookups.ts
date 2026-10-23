import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lookups } from "./types";

/** What the grid and the item panel need besides the items: projects, people, Initiative Groups and teams of the workspace. */
export async function loadLookups(supabase: SupabaseClient, tenantId: string): Promise<Lookups> {
  const [projects, groups, teams, people, connection, links] = await Promise.all([
    supabase.from("projects").select("id, name").eq("tenant_id", tenantId).order("name"),
    supabase.from("item_groups").select("name").eq("tenant_id", tenantId).order("name"),
    supabase.from("teams").select("id, name").eq("tenant_id", tenantId).order("name"),
    supabase.rpc("tenant_directory", { p_tenant: tenantId }),
    supabase.from("github_connections").select("id").eq("tenant_id", tenantId).eq("state", "connected").maybeSingle(),
    supabase.from("item_github_links").select("item_id, mode, issue_number, html_url, sync_state, last_error").eq("tenant_id", tenantId),
  ]);
  return {
    projects: (projects.data ?? []) as { id: string; name: string }[],
    members: ((people.data ?? []) as { user_id: string; email: string }[]).map((p) => ({ user_id: p.user_id, email: p.email })),
    groups: ((groups.data ?? []) as { name: string }[]).map((g) => g.name),
    teams: (teams.data ?? []) as { id: string; name: string }[],
    github: {
      connected: Boolean(connection.data),
      links: Object.fromEntries(
        ((links.data ?? []) as { item_id: string; mode: "push" | "follow"; issue_number: number | null; html_url: string | null; sync_state: "pending" | "synced" | "error"; last_error: string | null }[]).map((l) => [l.item_id, { mode: l.mode, number: l.issue_number, url: l.html_url, state: l.sync_state, error: l.last_error }]),
      ),
    },
  };
}
