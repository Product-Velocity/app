import "server-only";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { verifyConnectState } from "./connect-state";
import { API_BASE, atlassianConfig, exchangeCode } from "./oauth";
import { storeCredentials, type JiraSite } from "./server";
import { keyRing } from "./token-crypto";

const PAGE = "/settings/integrations/jira";

/**
 * The real Jira connection (issue #67): the OAuth return for a state signed by startJiraConnection.
 * Returns the page to send the person to. A connection is one Atlassian sign-in; the sites it reaches are listed on it.
 */
export async function completeConnection(request: NextRequest, state: string): Promise<string> {
  const url = new URL(request.url);
  const cfg = atlassianConfig();
  const ring = keyRing();
  if (!cfg || !ring) return `${PAGE}?status=not-configured`;
  const parsed = verifyConnectState(state, ring.current);
  if (!parsed) return `${PAGE}?status=bad-link`;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return `/sign-in?next=${encodeURIComponent(PAGE)}`;
  if (auth.user.id !== parsed.u) return `${PAGE}?status=bad-link`;
  const { data: me } = await supabase.from("tenant_members").select("role, is_service_account").eq("tenant_id", parsed.t).eq("user_id", auth.user.id).maybeSingle();
  if (!me || me.role !== "admin" || me.is_service_account) return `${PAGE}?status=not-admin`;

  const code = url.searchParams.get("code");
  if (!code) return `${PAGE}?status=denied`;
  let tokens;
  try {
    tokens = await exchangeCode(cfg, code);
  } catch {
    return `${PAGE}?status=error`;
  }
  const res = await fetch(`${API_BASE}/oauth/token/accessible-resources`, { headers: { authorization: `Bearer ${tokens.access_token}`, accept: "application/json" } });
  const found = res.ok ? ((await res.json()) as { id: string; name: string; url: string; scopes: string[] }[]) : [];
  const sites: JiraSite[] = found.filter((s) => s.scopes.some((x) => x.endsWith(":jira-work"))).map((s) => ({ id: s.id, name: s.name, url: s.url }));
  if (sites.length === 0) return `${PAGE}?status=no-site`;

  const admin = createAdminClient({ via: "UI" });
  const { data: open } = await admin.from("jira_connections").select("id, sites").eq("tenant_id", parsed.t).neq("state", "disconnected");
  // signing in again for a site this workspace already has replaces that connection instead of adding a second one
  const same = (open ?? []).find((c) => (c.sites as JiraSite[]).some((s) => sites.some((n) => n.id === s.id)));
  let connectionId = same?.id as string | undefined;
  const fields = { sites, scopes: tokens.scope, state: "connected" as const, connected_by: auth.user.id };
  if (connectionId) {
    const { error } = await admin.from("jira_connections").update(fields).eq("id", connectionId);
    if (error) return `${PAGE}?status=error`;
  } else {
    const { data, error } = await admin.from("jira_connections").insert({ tenant_id: parsed.t, created_by: auth.user.id, created_via: "UI", ...fields }).select("id").single();
    if (error || !data) return `${PAGE}?status=error`;
    connectionId = data.id as string;
    // Disconnect keeps the project links and linked initiatives of a workspace that uses them; a new sign-in takes them over, or the sync would never see them again
    await admin.rpc("jira_adopt_orphans", { p_connection: connectionId });
  }
  try {
    await storeCredentials(connectionId, parsed.t, { accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? null, expiresAt: Date.now() + tokens.expires_in * 1000 });
  } catch {
    return `${PAGE}?status=error`;
  }
  return `${PAGE}?status=connected`;
}
