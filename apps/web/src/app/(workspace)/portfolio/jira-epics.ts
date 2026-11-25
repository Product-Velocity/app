"use server";

import { requireWorkspace } from "@/lib/session";
import { checkEpics, type Ctx, type EpicCheck } from "@/lib/atlassian/jira-sync-engine";
import { siteUrl } from "@/lib/site-url";

// The check on an initiative's Jira tab (issue #431): for each epic a person asked for under the initiative, would Sync with Jira link it (OK) or
// why not. READ ONLY: it reads Jira and writes nothing, here or there. Same gate as Sync with Jira: only creators and admins, never Claude
// (MCP), service accounts or platform staff.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function checkJiraEpics(itemId: string, keys?: string[]): Promise<EpicCheck> {
  const ctx = await requireWorkspace("/portfolio");
  if (typeof itemId !== "string" || !UUID.test(itemId)) return { ok: false, error: "Choose an initiative." };
  if (keys !== undefined && (!Array.isArray(keys) || keys.length > 50 || keys.some((k) => typeof k !== "string" || k.length > 40))) return { ok: false, error: "Choose up to 50 epics to check." };
  const { data: me } = await ctx.supabase.from("tenant_members").select("is_service_account").eq("tenant_id", ctx.active.tenantId).eq("user_id", ctx.user.id).maybeSingle();
  if (!["creator", "admin"].includes(ctx.active.role) || me?.is_service_account || ctx.active.platform) return { ok: false, error: "Only creators and admins of the account can check epics with Jira." };
  const c: Ctx = { supabase: ctx.supabase as never, tenantId: ctx.active.tenantId, userId: ctx.user.id, appUrl: await siteUrl() };
  return checkEpics(c, itemId, keys ? { keys } : {});
}
