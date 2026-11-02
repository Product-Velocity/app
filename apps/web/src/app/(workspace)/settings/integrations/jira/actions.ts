"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { buildAuthorizeUrl, atlassianConfig, JIRA_SCOPES } from "@/lib/atlassian/oauth";
import { signConnectState } from "@/lib/atlassian/connect-state";
import { keyRing } from "@/lib/atlassian/token-crypto";
import { requireWorkspace } from "@/lib/session";

const PATH = "/settings/integrations/jira";

async function adminOnly() {
  const ctx = await requireWorkspace(PATH);
  const { data: me } = await ctx.supabase.from("tenant_members").select("is_service_account").eq("tenant_id", ctx.active.tenantId).eq("user_id", ctx.user.id).maybeSingle();
  if (ctx.active.role !== "admin" || me?.is_service_account || ctx.active.platform) return null; // platform staff never reach integration secrets (rule 10)
  return ctx;
}

/** Sends the admin to Atlassian's consent screen with a signed, ten-minute state tied to this person and workspace. */
export async function startJiraConnection(): Promise<void> {
  const ctx = await adminOnly();
  if (!ctx) redirect(`${PATH}?status=not-admin`);
  const cfg = atlassianConfig();
  const ring = keyRing();
  if (!cfg || !ring) redirect(`${PATH}?status=not-configured`);
  redirect(buildAuthorizeUrl(cfg, JIRA_SCOPES, signConnectState(ctx.active.tenantId, ctx.user.id, ring.current)));
}

/** Ends a connection and deletes its saved sign-in. The database checks that the person is a human admin of the workspace. */
export async function disconnectJira(form: FormData): Promise<void> {
  const ctx = await adminOnly();
  if (!ctx) redirect(`${PATH}?status=not-admin`);
  const id = String(form.get("id") ?? "");
  const { error } = await ctx.supabase.rpc("jira_disconnect", { p_connection: id });
  revalidatePath(PATH);
  redirect(`${PATH}?status=${error ? "error" : "disconnected"}`);
}
