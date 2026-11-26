"use server";

import { redirect } from "next/navigation";
import { buildAuthorizeUrl, atlassianConfig, CONFLUENCE_SCOPES } from "@/lib/atlassian/oauth";
import { signConnectState } from "@/lib/atlassian/connect-state";
import { keyRing } from "@/lib/atlassian/token-crypto";
import { listSpaces } from "@/lib/confluence/client";
import { confluenceRequest, confluenceSiteFor } from "@/lib/confluence/server";
import { requireWorkspace } from "@/lib/session";

// Settings, Integrations, Confluence (issue #693). Confluence has its own connection, separate from Jira's: connecting, reconnecting or disconnecting it never
// touches Jira's connection, project links or field mapping. Only a human workspace admin can use these (platform staff never reach integration secrets, rule 10).

const PATH = "/settings/integrations/confluence";

async function adminOnly() {
  const ctx = await requireWorkspace(PATH);
  const { data: me } = await ctx.supabase.from("tenant_members").select("is_service_account").eq("tenant_id", ctx.active.tenantId).eq("user_id", ctx.user.id).maybeSingle();
  if (ctx.active.role !== "admin" || me?.is_service_account || ctx.active.platform) return null;
  return ctx;
}

/**
 * Sends the admin to Atlassian's consent screen with a signed, ten-minute state tied to this person and workspace and marked as the Confluence sign-in.
 * It is also "Reconnect": signing in again replaces the live Confluence connection in place, so nothing is lost.
 */
export async function startConfluenceConnect(): Promise<void> {
  const ctx = await adminOnly();
  if (!ctx) redirect(`${PATH}?status=not-admin`);
  const cfg = atlassianConfig();
  const ring = keyRing();
  if (!cfg || !ring) redirect(`${PATH}?status=not-configured`);
  redirect(buildAuthorizeUrl(cfg, CONFLUENCE_SCOPES, signConnectState(ctx.active.tenantId, ctx.user.id, ring.current, Date.now(), "confluence")));
}

/** Ends the Confluence connection and deletes its saved sign-in. The database checks that the person is a human admin of the workspace. Jira is not touched. */
export async function disconnectConfluence(form: FormData): Promise<void> {
  const ctx = await adminOnly();
  if (!ctx) redirect(`${PATH}?status=not-admin`);
  const id = String(form.get("id") ?? "");
  const { error } = await ctx.supabase.rpc("confluence_disconnect", { p_connection: id });
  redirect(`${PATH}?status=${error ? "error" : "disconnected"}`);
}

/** Asks Confluence for the list of spaces with the saved sign-in and says what happened, with Atlassian's own reason when it refuses. Reads only. */
export async function testConfluence(): Promise<void> {
  const ctx = await adminOnly();
  if (!ctx) redirect(`${PATH}?status=not-admin`);
  const site = await confluenceSiteFor(ctx.active.tenantId);
  if (!site) redirect(`${PATH}?status=not-connected`);
  const r = await listSpaces(confluenceRequest(site.connectionId, site.siteId));
  redirect(r.ok ? `${PATH}?test=ok&n=${r.spaces.length}` : `${PATH}?test=fail&why=${encodeURIComponent(r.message.slice(0, 400))}`);
}
