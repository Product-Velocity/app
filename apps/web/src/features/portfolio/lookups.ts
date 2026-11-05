import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lookups } from "./types";

/** What the grid and the item panel need besides the items: projects, people, Initiative Groups and teams of the workspace. */
export async function loadLookups(supabase: SupabaseClient, tenantId: string): Promise<Lookups> {
  const [projects, groups, teams, people, connection, links, cycle, usernames, tenant, jira, jiraLinks] = await Promise.all([
    supabase.from("projects").select("id, name, tracker").eq("tenant_id", tenantId).order("name"),
    supabase.from("item_groups").select("name").eq("tenant_id", tenantId).order("name"),
    supabase.from("teams").select("id, name").eq("tenant_id", tenantId).order("name"),
    supabase.rpc("tenant_directory", { p_tenant: tenantId }),
    supabase.from("github_connections").select("id").eq("tenant_id", tenantId).eq("state", "connected").maybeSingle(),
    supabase.from("item_github_links").select("item_id, mode, issue_number, html_url, sync_state, last_error, gh_state, gh_last_activity, frozen_at").eq("tenant_id", tenantId),
    supabase.rpc("item_build_cycle", { p_tenant: tenantId }),
    supabase.from("tenant_members").select("user_id, github_username").eq("tenant_id", tenantId),
    supabase.from("tenants").select("currency").eq("id", tenantId).maybeSingle(),
    supabase.from("jira_connections").select("id").eq("tenant_id", tenantId).eq("state", "connected").limit(1),
    supabase.from("item_jira_links").select("item_id, mode, issue_key, html_url, jira_status, jira_status_category, sync_checked_at, jira_updated_at, frozen_at").eq("tenant_id", tenantId),
  ]);
  const githubName = new Map(((usernames.data ?? []) as { user_id: string; github_username: string | null }[]).map((m) => [m.user_id, m.github_username]));
  const build = new Map(((cycle.data ?? []) as { item_id: string; build_started_at: string | null; build_completed_at: string | null; build_days: number | string | null }[]).map((r) => [r.item_id, r]));
  // initiatives whose tracker link is frozen (finished more than 14 days ago): the panel says so and offers Resume
  const frozen = [...((links.data ?? []) as { item_id: string; frozen_at?: string | null }[]), ...((jiraLinks.data ?? []) as { item_id: string; frozen_at?: string | null }[])].filter((l) => l.frozen_at).map((l) => l.item_id);
  return {
    frozen,
    currency: (tenant.data as { currency: string | null } | null)?.currency ?? null,
    projects: ((projects.data ?? []) as { id: string; name: string }[]).map(({ id, name }) => ({ id, name })),
    jira: {
      links: Object.fromEntries(
        ((jiraLinks.data ?? []) as { item_id: string; mode: "push" | "follow"; issue_key: string; html_url: string | null; jira_status: string | null; jira_status_category: "new" | "indeterminate" | "done" | null; sync_checked_at: string | null }[])
          .map((l) => [l.item_id, { mode: l.mode, issueKey: l.issue_key, url: l.html_url, status: l.jira_status, category: l.jira_status_category, lastSynced: l.sync_checked_at }]),
      ),
    },
    trackers: { jira: ((jira.data ?? []) as unknown[]).length > 0, projectTracker: Object.fromEntries(((projects.data ?? []) as { id: string; tracker?: "github" | "jira" | null }[]).map((p) => [p.id, p.tracker ?? null])) },
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
