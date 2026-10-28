import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lookups } from "./types";

/** What the grid and the item panel need besides the items: projects, people, Initiative Groups and teams of the workspace. */
export async function loadLookups(supabase: SupabaseClient, tenantId: string): Promise<Lookups> {
  const [projects, groups, teams, people, connection, links, cycle, usernames] = await Promise.all([
    supabase.from("projects").select("id, name").eq("tenant_id", tenantId).order("name"),
    supabase.from("item_groups").select("name").eq("tenant_id", tenantId).order("name"),
    supabase.from("teams").select("id, name").eq("tenant_id", tenantId).order("name"),
    supabase.rpc("tenant_directory", { p_tenant: tenantId }),
    supabase.from("github_connections").select("id").eq("tenant_id", tenantId).eq("state", "connected").maybeSingle(),
    supabase.from("item_github_links").select("item_id, mode, issue_number, html_url, sync_state, last_error, gh_state, gh_last_activity").eq("tenant_id", tenantId),
    supabase.rpc("item_build_cycle", { p_tenant: tenantId }),
    supabase.from("tenant_members").select("user_id, github_username").eq("tenant_id", tenantId),
  ]);
  const githubName = new Map(((usernames.data ?? []) as { user_id: string; github_username: string | null }[]).map((m) => [m.user_id, m.github_username]));
  const build = new Map(((cycle.data ?? []) as { item_id: string; build_started_at: string | null; build_completed_at: string | null; build_days: number | string | null }[]).map((r) => [r.item_id, r]));
  return {
    projects: (projects.data ?? []) as { id: string; name: string }[],
    members: ((people.data ?? []) as { user_id: string; email: string }[]).map((p) => ({ user_id: p.user_id, email: p.email, github_username: githubName.get(p.user_id) ?? null })),
    groups: ((groups.data ?? []) as { name: string }[]).map((g) => g.name),
    teams: (teams.data ?? []) as { id: string; name: string }[],
    github: {
      connected: Boolean(connection.data),
      links: Object.fromEntries(
        ((links.data ?? []) as { item_id: string; mode: "push" | "follow"; issue_number: number | null; html_url: string | null; sync_state: "pending" | "synced" | "error"; last_error: string | null; gh_state: "open" | "closed_completed" | "closed_not_planned" | null; gh_last_activity: string | null }[]).map((l) => [l.item_id, { mode: l.mode, number: l.issue_number, url: l.html_url, state: l.sync_state, error: l.last_error, ghState: l.gh_state, lastActivity: l.gh_last_activity, buildStartedAt: build.get(l.item_id)?.build_started_at ?? null, buildCompletedAt: build.get(l.item_id)?.build_completed_at ?? null, buildDays: build.get(l.item_id)?.build_days == null ? null : Number(build.get(l.item_id)!.build_days) }]),
      ),
    },
  };
}
