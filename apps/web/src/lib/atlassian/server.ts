import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { atlassianConfig, API_BASE, refreshTokens } from "./oauth";
import { decryptToken, encryptToken, keyRing } from "./token-crypto";
import { getAccessToken, type TokenDeps } from "./token-provider";
import { getJson } from "./read-client";

export type JiraSite = { id: string; name: string; url: string };
export type JiraConnectionRow = { id: string; tenant_id: string; sites: JiraSite[]; scopes: string; state: "connected" | "reconnect_needed" | "disconnected"; connected_by: string | null; state_changed_at: string; created_at: string };

export const jiraConfigured = () => Boolean(atlassianConfig() && keyRing());

/** Stores (or replaces) the encrypted tokens of a connection. Server only: the table has no grant for signed-in users. */
export async function storeCredentials(connectionId: string, tenantId: string, t: { accessToken: string; refreshToken: string | null; expiresAt: number }) {
  const ring = keyRing();
  if (!ring) throw new Error("ATLASSIAN_TOKEN_KEY is not set");
  const access = encryptToken(t.accessToken, ring);
  const refresh = t.refreshToken ? encryptToken(t.refreshToken, ring).value : null;
  const admin = createAdminClient({ via: "UI" });
  const { data: existing } = await admin.from("jira_credentials").select("version").eq("connection_id", connectionId).maybeSingle();
  const row = { connection_id: connectionId, tenant_id: tenantId, access_token_enc: access.value, refresh_token_enc: refresh, key_id: access.keyId, access_expires_at: new Date(t.expiresAt).toISOString(), refresh_lease_until: null, version: ((existing?.version as number | undefined) ?? 0) + 1, updated_at: new Date().toISOString() };
  const { error } = await admin.from("jira_credentials").upsert(row, { onConflict: "connection_id" });
  if (error) throw new Error("Could not store the Jira credentials");
}

function depsFor(connectionId: string): TokenDeps {
  const ring = keyRing();
  const cfg = atlassianConfig();
  if (!ring || !cfg) throw new Error("Jira is not configured for this deployment");
  const admin = createAdminClient({ via: "system" });
  return {
    load: async () => {
      const { data } = await admin.from("jira_credentials").select("access_token_enc, refresh_token_enc, access_expires_at").eq("connection_id", connectionId).maybeSingle();
      if (!data) return null;
      return { accessToken: decryptToken(data.access_token_enc as string, ring), refreshToken: data.refresh_token_enc ? decryptToken(data.refresh_token_enc as string, ring) : null, expiresAt: Date.parse(data.access_expires_at as string) };
    },
    claim: async () => Boolean((await admin.rpc("jira_refresh_claim", { p_connection: connectionId, p_seconds: 30 })).data),
    store: async (n) => {
      const { data: c } = await admin.from("jira_connections").select("tenant_id").eq("id", connectionId).single();
      await storeCredentials(connectionId, c?.tenant_id as string, n);
    },
    refresh: (rt) => refreshTokens(cfg, rt),
    markReconnectNeeded: async () => {
      await admin.from("jira_connections").update({ state: "reconnect_needed" }).eq("id", connectionId).eq("state", "connected");
      await admin.from("jira_credentials").update({ refresh_lease_until: null }).eq("connection_id", connectionId);
    },
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

/** A usable access token for a connection (refreshed safely when needed). Throws ReconnectNeeded when the person must sign in again. */
export const accessTokenFor = (connectionId: string) => getAccessToken(depsFor(connectionId));

export async function jiraGet<T>(connectionId: string, siteId: string, path: string): Promise<T> {
  // 429 and 503 are retried with the site's Retry-After (spike J6); any other refusal throws "Jira answered <status>"
  return getJson<T>(jiraRequest(connectionId, siteId), path);
}

export type JiraProjectDetail = { id: string; key: string; name: string; projectTypeKey: string; issueTypes: { id: string; name: string; hierarchyLevel: number; subtask: boolean }[] };

/** One Jira project with its OWN issue types (they differ per project). */
export async function jiraProjectDetail(connectionId: string, siteId: string, key: string): Promise<JiraProjectDetail> {
  if (!/^[A-Z][A-Z0-9_]{1,19}$/.test(key)) throw new Error("Not a Jira project key");
  const r = await jiraGet<{ id: string; key: string; name: string; projectTypeKey: string; issueTypes?: { id: string; name: string; hierarchyLevel?: number; subtask?: boolean }[] }>(connectionId, siteId, `/project/${key}`);
  return { id: r.id, key: r.key, name: r.name, projectTypeKey: r.projectTypeKey, issueTypes: (r.issueTypes ?? []).map((t) => ({ id: t.id, name: t.name, hierarchyLevel: t.hierarchyLevel ?? 0, subtask: Boolean(t.subtask) })) };
}

/**
 * A request function for ONE site of a connection, for the write side of Sync: it returns the status and body instead of throwing, and the
 * Retry-After of a 429, so the caller can back off (jira-write.ts). ReconnectNeeded from the token provider propagates.
 */
export function jiraRequest(connectionId: string, siteId: string): import("./jira-write").JiraRequest {
  return async (method, path, body) => {
    const token = await accessTokenFor(connectionId);
    const res = await fetch(`${API_BASE}/ex/jira/${siteId}/rest/api/3${path}`, {
      method,
      // a Jira site that does not answer must not leave the Sync dialog on "Checking…" for ever: give up after 20 s (the card then says it could not be checked)
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

/** The start-date candidates and the priorities of one Jira site, for the field mapping form. Reads only. */
export async function jiraFieldChoices(connectionId: string, siteId: string): Promise<{ startDates: import("./field-map").FieldChoice[]; themes: import("./field-map").FieldChoice[]; priorities: import("./field-map").FieldChoice[] }> {
  const { startDateChoices, themeChoices, priorityChoices } = await import("./field-map");
  const [fields, priorities] = await Promise.all([jiraGet<import("./field-catalog").JiraField[]>(connectionId, siteId, "/field"), jiraGet<unknown>(connectionId, siteId, "/priority")]);
  return { startDates: startDateChoices(fields), themes: themeChoices(fields), priorities: priorityChoices(priorities) };
}
