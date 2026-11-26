import "server-only";
import { API_BASE, CONFLUENCE_REQUIRED } from "@/lib/atlassian/oauth";
import { accessTokenFor } from "@/lib/atlassian/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ConfluenceRequest } from "./client";

/** Where a workspace reaches Confluence: the site of its own Confluence connection (separate from Jira's), and which permissions that sign-in lacks. */
export type ConfluenceSite = { connectionId: string; siteId: string; siteUrl: string; siteName: string; /** Permissions the sign-in was not granted (empty when it has them all). */ missingScopes: string[] };
export type ConfluenceSiteInfo = { id: string; name: string; url: string };

/**
 * The connected Confluence site of a workspace, or null. Read with the service role, scoped by the workspace id the caller got from a document it could read,
 * and only ids and names leave this function (never a token).
 */
export async function confluenceSiteFor(tenantId: string): Promise<ConfluenceSite | null> {
  const admin = createAdminClient({ via: "system" });
  const { data } = await admin.from("confluence_connections").select("id, sites, scopes").eq("tenant_id", tenantId).eq("state", "connected").order("created_at", { ascending: false }).limit(1);
  const c = (data ?? [])[0] as { id: string; sites: ConfluenceSiteInfo[]; scopes: string } | undefined;
  const site = c?.sites?.[0];
  if (!c || !site) return null;
  const granted = String(c.scopes ?? "").split(/\s+/);
  return { connectionId: c.id, siteId: site.id, siteUrl: site.url, siteName: site.name, missingScopes: CONFLUENCE_REQUIRED.filter((x) => !granted.includes(x)) };
}

/**
 * A request function for ONE Confluence site of a connection. It returns the status and body instead of throwing, plus the Retry-After of a 429, so
 * the client can back off. ReconnectNeeded from the token provider propagates. Nothing is logged.
 */
export function confluenceRequest(connectionId: string, siteId: string): ConfluenceRequest {
  return async (method, path, body) => {
    const token = await accessTokenFor(connectionId, "confluence");
    const res = await fetch(`${API_BASE}/ex/confluence/${encodeURIComponent(siteId)}/wiki${path}`, {
      method,
      // a Confluence site that does not answer must not leave the dialog on "Checking…" for ever
      signal: AbortSignal.timeout(20_000),
      headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let json: unknown = null;
    try { json = res.status === 204 ? null : await res.json(); } catch { json = null; }
    const ra = Number(res.headers.get("retry-after"));
    return { status: res.status, json, ...(Number.isFinite(ra) && ra > 0 ? { retryAfterSec: ra } : {}) };
  };
}
