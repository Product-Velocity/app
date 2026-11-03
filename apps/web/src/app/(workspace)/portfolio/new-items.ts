"use server";

import { requireWorkspace } from "@/lib/session";
import { githubSourceControl, type ConnectionRow } from "@/lib/github/server";
import { refreshIncoming, sinceFor } from "@/lib/github/incoming-refresh";
import { createAdminClient } from "@/lib/supabase/admin";
import { readJiraLink } from "@/lib/atlassian/read-jira";

/**
 * The first step of Sync with GitHub reads what is new in GitHub before it lists it: for every repository only the issues that changed since
 * the last full check (webhooks keep the list current; this covers what they missed). Writes nothing to GitHub. Creators and admins only.
 */
export async function refreshNewItems(): Promise<{ ok: true; repos: number; read: number; failed: number } | { ok: false; error: string }> {
  const ctx = await requireWorkspace("/portfolio");
  const { data: me } = await ctx.supabase.from("tenant_members").select("is_service_account").eq("tenant_id", ctx.active.tenantId).eq("user_id", ctx.user.id).maybeSingle();
  if (!["creator", "admin"].includes(ctx.active.role) || me?.is_service_account || ctx.active.platform) return { ok: false, error: "Only creators and admins can read new issues." };
  const sc = githubSourceControl();
  if (!sc) return { ok: false, error: "The GitHub App is not set up for this deployment yet." };
  const { data } = await ctx.supabase.from("github_connections").select("*").eq("tenant_id", ctx.active.tenantId).eq("state", "connected").maybeSingle();
  if (!data) return { ok: false, error: "This workspace is not connected to GitHub." };
  const connection = data as ConnectionRow & { last_check_at: string | null };
  const r = await refreshIncoming(createAdminClient({ via: "GitHub webhook" }), sc, connection, sinceFor(connection.last_check_at, Date.now()));
  return { ok: true, ...r };
}

/**
 * The first step of Sync for Jira projects reads the open issues of every linked Jira project before it lists them (issue #67 C2b).
 * Reads Jira only; nothing is written to Jira. Creators and admins only. A project that cannot be read is counted, not fatal.
 */
export async function refreshJiraNewItems(): Promise<{ ok: true; projects: number; failed: number } | { ok: false; error: string }> {
  const ctx = await requireWorkspace("/portfolio");
  const { data: me } = await ctx.supabase.from("tenant_members").select("is_service_account").eq("tenant_id", ctx.active.tenantId).eq("user_id", ctx.user.id).maybeSingle();
  if (!["creator", "admin"].includes(ctx.active.role) || me?.is_service_account || ctx.active.platform) return { ok: false, error: "Only creators and admins can read new issues." };
  const { data: links } = await ctx.supabase.from("jira_project_links").select("id, tenant_id, connection_id, site_id, jira_project_key").eq("tenant_id", ctx.active.tenantId);
  const { data: conns } = await ctx.supabase.from("jira_connections").select("id, sites, state").eq("tenant_id", ctx.active.tenantId).eq("state", "connected");
  let projects = 0;
  let failed = 0;
  for (const l of (links ?? []) as { id: string; tenant_id: string; connection_id: string; site_id: string; jira_project_key: string }[]) {
    const site = ((conns ?? []) as { id: string; sites: { id: string; url: string }[] }[]).find((c) => c.id === l.connection_id)?.sites.find((x) => x.id === l.site_id);
    if (!site) { failed++; continue; }
    try {
      await readJiraLink(l, site.url);
      projects++;
    } catch {
      failed++;
    }
  }
  return { ok: true, projects, failed };
}
