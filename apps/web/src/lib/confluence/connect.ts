import "server-only";
import type { ConnectState } from "@/lib/atlassian/connect-state";
import { API_BASE, atlassianConfig, exchangeCode } from "@/lib/atlassian/oauth";
import { storeCredentials } from "@/lib/atlassian/server";
import { keyRing } from "@/lib/atlassian/token-crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const PAGE = "/settings/integrations/confluence";

/**
 * The return of the Confluence sign-in (issue #693): a connection of its own, separate from Jira's. Signing in again replaces the workspace's live Confluence
 * connection in place (the same row, new tokens and permissions), so nothing that refers to it is lost; the Jira connection and everything linked to it is never
 * read or changed here. Returns the page to send the person to.
 */
export async function completeConfluenceConnection(request: Request, parsed: ConnectState): Promise<string> {
  const url = new URL(request.url);
  const cfg = atlassianConfig();
  const ring = keyRing();
  if (!cfg || !ring) return `${PAGE}?status=not-configured`;

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
  // the sites that have Confluence and let this sign-in use it (a site with only Jira on it is not a Confluence site)
  const sites = found.filter((s) => s.scopes.some((x) => /confluence/.test(x))).map((s) => ({ id: s.id, name: s.name, url: s.url }));
  if (sites.length === 0) return `${PAGE}?status=no-site`;

  const admin = createAdminClient({ via: "UI" });
  const { data: open } = await admin.from("confluence_connections").select("id").eq("tenant_id", parsed.t).neq("state", "disconnected").limit(1);
  let connectionId = (open ?? [])[0]?.id as string | undefined;
  const fields = { sites, scopes: tokens.scope, state: "connected" as const, connected_by: auth.user.id };
  if (connectionId) {
    const { error } = await admin.from("confluence_connections").update(fields).eq("id", connectionId);
    if (error) return `${PAGE}?status=error`;
  } else {
    const { data, error } = await admin.from("confluence_connections").insert({ tenant_id: parsed.t, created_by: auth.user.id, created_via: "UI", ...fields }).select("id").single();
    if (error || !data) return `${PAGE}?status=error`;
    connectionId = data.id as string;
  }
  try {
    await storeCredentials(connectionId, parsed.t, { accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? null, expiresAt: Date.now() + tokens.expires_in * 1000 }, "confluence");
  } catch {
    return `${PAGE}?status=error`;
  }
  return `${PAGE}?status=connected`;
}
