"use server";

import { requireWorkspace } from "@/lib/session";
import type { RemovedList, RemovedResult } from "@/lib/github/push-types";
import { closeOne, listRemoved } from "@/lib/atlassian/jira-removed-engine";
import type { Ctx } from "@/lib/atlassian/jira-sync-engine";

// "Removed in Product Velocity" in Sync with Jira (decision 2026-11-03-jira-close-removed). listRemovedInJira reads (writes nothing);
// closeRemovedInJira labels and closes ONE initiative's issue after the person confirmed it in the dialog. Only creators and admins reach it:
// Claude (MCP) has no tool for it, service accounts are refused here and again by the database function, platform staff are refused here.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRANSITION = /^[0-9]{1,10}$/;

async function gate() {
  const ctx = await requireWorkspace("/portfolio");
  const { data: me } = await ctx.supabase.from("tenant_members").select("is_service_account").eq("tenant_id", ctx.active.tenantId).eq("user_id", ctx.user.id).maybeSingle();
  if (!["creator", "admin"].includes(ctx.active.role) || me?.is_service_account || ctx.active.platform) return { ok: false, error: "Only creators and admins of the account can close Jira issues of removed initiatives." } as const;
  const c: Ctx = { supabase: ctx.supabase as never, tenantId: ctx.active.tenantId, userId: ctx.user.id };
  return { ok: true, ctx: c } as const;
}

export async function listRemovedInJira(): Promise<RemovedList> {
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };
  return listRemoved(g.ctx);
}

export async function closeRemovedInJira(id: string, transitionId: string | null): Promise<{ ok: true; result: RemovedResult } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "Choose an initiative." };
  if (transitionId !== null && (typeof transitionId !== "string" || !TRANSITION.test(transitionId))) return { ok: false, error: "That is not a Jira transition." };
  return { ok: true, ...(await closeOne(g.ctx, id, transitionId)) };
}
