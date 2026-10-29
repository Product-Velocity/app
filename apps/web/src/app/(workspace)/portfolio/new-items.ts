"use server";

import { requireWorkspace } from "@/lib/session";
import { githubSourceControl, type ConnectionRow } from "@/lib/github/server";
import { refreshIncoming, sinceFor } from "@/lib/github/incoming-refresh";
import { createAdminClient } from "@/lib/supabase/admin";

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
