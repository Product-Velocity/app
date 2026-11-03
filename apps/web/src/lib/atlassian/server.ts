import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { atlassianConfig, API_BASE, refreshTokens } from "./oauth";
import { decryptToken, encryptToken, keyRing } from "./token-crypto";
import { getAccessToken, type TokenDeps } from "./token-provider";

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
  const token = await accessTokenFor(connectionId);
  const res = await fetch(`${API_BASE}/ex/jira/${siteId}/rest/api/3${path}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
  if (!res.ok) throw new Error(`Jira answered ${res.status}`);
  return (await res.json()) as T;
}

export type JiraProjectDetail = { id: string; key: string; name: string; projectTypeKey: string; issueTypes: { id: string; name: string; hierarchyLevel: number; subtask: boolean }[] };

/** One Jira project with its OWN issue types (they differ per project). */
export async function jiraProjectDetail(connectionId: string, siteId: string, key: string): Promise<JiraProjectDetail> {
  if (!/^[A-Z][A-Z0-9_]{1,19}$/.test(key)) throw new Error("Not a Jira project key");
  const r = await jiraGet<{ id: string; key: string; name: string; projectTypeKey: string; issueTypes?: { id: string; name: string; hierarchyLevel?: number; subtask?: boolean }[] }>(connectionId, siteId, `/project/${key}`);
  return { id: r.id, key: r.key, name: r.name, projectTypeKey: r.projectTypeKey, issueTypes: (r.issueTypes ?? []).map((t) => ({ id: t.id, name: t.name, hierarchyLevel: t.hierarchyLevel ?? 0, subtask: Boolean(t.subtask) })) };
}
