import "server-only";
import { API_BASE } from "@/lib/atlassian/oauth";
import { accessTokenFor, type JiraSite } from "@/lib/atlassian/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ConfluenceRequest } from "./client";

/** Where a workspace publishes to: the Atlassian connection that was signed in with Confluence permission, and the site it reaches. */
export type ConfluenceSite = { connectionId: string; siteId: string; siteUrl: string; siteName: string };

/** The scope that lets the sign-in create and edit pages. A connection made before Confluence was added does not have it (an admin adds it in Settings, Integrations, Jira). */
export const CONFLUENCE_WRITE_SCOPE = "write:confluence-content";

/**
 * The connected Atlassian site of a workspace that can publish, or null. Read with the service role, scoped by the workspace id the caller got from
 * a document it could read, and only ids and names leave this function (never a token).
 */
export async function confluenceSiteFor(tenantId: string): Promise<ConfluenceSite | null> {
  const admin = createAdminClient({ via: "system" });
  const { data } = await admin.from("jira_connections").select("id, sites, scopes").eq("tenant_id", tenantId).eq("state", "connected").order("created_at");
  for (const c of data ?? []) {
    if (!String(c.scopes ?? "").split(/\s+/).includes(CONFLUENCE_WRITE_SCOPE)) continue;
    const sites = (c.sites as (JiraSite & { confluence?: boolean })[]) ?? [];
    const site = sites.find((s) => s.confluence === true) ?? sites[0];
    if (site) return { connectionId: c.id as string, siteId: site.id, siteUrl: site.url, siteName: site.name };
  }
  return null;
}

/**
 * A request function for ONE Confluence site of a connection. It returns the status and body instead of throwing, plus the Retry-After of a 429, so
 * the client can back off. ReconnectNeeded from the token provider propagates. Nothing is logged.
 */
export function confluenceRequest(connectionId: string, siteId: string): ConfluenceRequest {
  return async (method, path, body) => {
    const token = await accessTokenFor(connectionId);
    const res = await fetch(`${API_BASE}/ex/confluence/${encodeURIComponent(siteId)}/wiki/rest/api${path}`, {
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
