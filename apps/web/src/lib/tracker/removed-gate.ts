import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireWorkspace } from "@/lib/session";

// Who may see and confirm "Removed in Product Velocity" (decisions 2026-11-03-jira-close-removed and 2026-11-03-github-close-removed): the same rule for
// both trackers, so it is written once. Only a creator or admin who is a person. Claude (MCP) has no tool for it, a service account is refused here (and
// again by the database function), platform staff are refused here (CLAUDE.md rules 3 and 10).
export type RemovedCtx = { supabase: SupabaseClient; tenantId: string; userId: string };

export async function removedGate(trackerName: string): Promise<{ ok: true; ctx: RemovedCtx } | { ok: false; error: string }> {
  const ctx = await requireWorkspace("/portfolio");
  const { data: me } = await ctx.supabase.from("tenant_members").select("is_service_account").eq("tenant_id", ctx.active.tenantId).eq("user_id", ctx.user.id).maybeSingle();
  if (!["creator", "admin"].includes(ctx.active.role) || me?.is_service_account || ctx.active.platform) return { ok: false, error: `Only creators and admins of the account can close ${trackerName} issues of removed initiatives.` };
  return { ok: true, ctx: { supabase: ctx.supabase as never, tenantId: ctx.active.tenantId, userId: ctx.user.id } };
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
