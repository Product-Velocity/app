"use server";

import { requireWorkspace } from "@/lib/session";
import { githubSourceControl, type ConnectionRow } from "@/lib/github/server";
import { executePush, planPush } from "@/lib/github/push";
import { PUSH_LIMIT, type ConfirmResult, type PreviewResult } from "@/lib/github/push-types";
import { siteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who may push, and to which connection. Only a creator or admin who is a person (not a service account). */
async function gate(ids: string[]) {
  const ctx = await requireWorkspace("/portfolio");
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((i) => typeof i === "string" && UUID.test(i))) return { ok: false, error: "Choose at least one initiative." } as const;
  if (ids.length > PUSH_LIMIT) return { ok: false, error: `Send up to ${PUSH_LIMIT} initiatives at a time.` } as const;
  const { data: me } = await ctx.supabase.from("tenant_members").select("is_service_account").eq("tenant_id", ctx.active.tenantId).eq("user_id", ctx.user.id).maybeSingle();
  if (!["creator", "admin"].includes(ctx.active.role) || me?.is_service_account) return { ok: false, error: "Only creators and admins can send to GitHub." } as const;
  const { data: conn } = await ctx.supabase.from("github_connections").select("*").eq("tenant_id", ctx.active.tenantId).eq("state", "connected").maybeSingle();
  if (!conn) return { ok: false, error: "This workspace is not connected to GitHub. An admin can connect it in Settings > GitHub." } as const;
  const sc = githubSourceControl();
  if (!sc) return { ok: false, error: "The GitHub App is not set up for this deployment yet." } as const;
  return { ok: true, ctx, sc, connection: conn as ConnectionRow, appUrl: await siteUrl() } as const;
}

/** Shows what would be written. Writes nothing. */
export async function previewGithubPush(ids: string[]): Promise<PreviewResult> {
  const g = await gate(ids);
  if (!g.ok) return { ok: false, error: g.error };
  const items = await planPush(g.ctx.supabase, g.ctx.active.tenantId, g.appUrl, g.connection, ids);
  return { ok: true, items, account: g.connection.account_login ?? g.connection.expected_account };
}

/** Writes to GitHub after the person confirmed the preview. The plan is recomputed here; nothing from the browser is trusted but the ids. */
export async function confirmGithubPush(ids: string[]): Promise<ConfirmResult> {
  const g = await gate(ids);
  if (!g.ok) return { ok: false, error: g.error };
  const results = await executePush({ supabase: g.ctx.supabase, admin: createAdminClient({ via: "UI" }), sc: g.sc, connection: g.connection, tenantId: g.ctx.active.tenantId, actor: g.ctx.user.id, appUrl: g.appUrl, ids });
  return { ok: true, results };
}
