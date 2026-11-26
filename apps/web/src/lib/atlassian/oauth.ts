// Atlassian OAuth 2.0 (3LO). Spike J1 (#257): only what is needed to connect once and read. Tokens are not stored.
export const AUTHORIZE_URL = "https://auth.atlassian.com/authorize";
export const TOKEN_URL = "https://auth.atlassian.com/oauth/token";
export const API_BASE = "https://api.atlassian.com";

/** Smallest list that lets the spike read and write issues; `offline_access` is what returns a refresh token. */
export const JIRA_SCOPES = ["read:jira-work", "read:jira-user", "write:jira-work", "offline_access"];
/**
 * The permissions of the Confluence connection (issue #693), which is its own sign-in, separate from Jira's. Confluence's current interface (v2, the only one
 * left after the removal of v1) is meant to be used with these granular permissions: read spaces, read pages (their text and version), write pages.
 * `offline_access` is what returns a refresh token. The Atlassian app in the developer console must have the Confluence API configured with exactly these,
 * or the consent screen refuses the sign-in (docs/14).
 */
export const CONFLUENCE_SCOPES = ["read:space:confluence", "read:page:confluence", "write:page:confluence", "read:folder:confluence", "read:hierarchical-content:confluence", "offline_access"];
/** Asked for, but not required: they let the page tree show Confluence folders. A connection made before they existed keeps working (without folders) until it is reconnected. */
export const CONFLUENCE_OPTIONAL = ["read:folder:confluence", "read:hierarchical-content:confluence"];
/** What a Confluence connection must have been granted to publish and to read pages (offline_access is not listed by Atlassian in the granted scopes). */
export const CONFLUENCE_REQUIRED = ["read:space:confluence", "read:page:confluence", "write:page:confluence"];

/** Added to the sign-in only when webhooks are switched on (JIRA_WEBHOOKS=1): lets the daily check register webhooks for automated status updates (spike J3). */
export const WEBHOOK_SCOPES = ["manage:jira-webhook"];

export type AtlassianConfig = { clientId: string; clientSecret: string; redirectUri: string };

export function atlassianConfig(env: Record<string, string | undefined> = process.env): AtlassianConfig | null {
  const clientId = env.ATLASSIAN_CLIENT_ID;
  const clientSecret = env.ATLASSIAN_CLIENT_SECRET;
  const redirectUri = env.ATLASSIAN_REDIRECT_URI;
  return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
}

export function buildAuthorizeUrl(cfg: Pick<AtlassianConfig, "clientId" | "redirectUri">, scopes: string[], state: string): string {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set("audience", "api.atlassian.com");
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("scope", scopes.join(" "));
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("prompt", "consent");
  return u.toString();
}

export type TokenResult = { access_token: string; refresh_token?: string; expires_in: number; scope: string };

export async function exchangeCode(cfg: AtlassianConfig, code: string): Promise<TokenResult> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code", client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: cfg.redirectUri }),
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status})`);
  return (await res.json()) as TokenResult;
}

/** Spike J1 leftover: does the refresh token work, and does it rotate (a new one comes back)? */
export async function refreshAccessToken(cfg: AtlassianConfig, refreshToken: string): Promise<{ status: number; rotated: boolean; hasAccessToken: boolean }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: refreshToken }),
  });
  const j = (res.ok ? await res.json() : {}) as { access_token?: string; refresh_token?: string };
  return { status: res.status, rotated: Boolean(j.refresh_token && j.refresh_token !== refreshToken), hasAccessToken: Boolean(j.access_token) };
}

export type RefreshOutcome =
  | { ok: true; accessToken: string; refreshToken: string | null; expiresIn: number }
  | { ok: false; status: number; reconnect: boolean };

/**
 * Refreshes for the real connection. Atlassian rotates the refresh token (spike J4): the returned one replaces the old one.
 * A 400 or 403 from the token endpoint means the grant is gone (revoked, expired or already used): `reconnect`.
 */
export async function refreshTokens(cfg: AtlassianConfig, refreshToken: string): Promise<RefreshOutcome> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: refreshToken }),
  });
  if (!res.ok) return { ok: false, status: res.status, reconnect: res.status === 400 || res.status === 401 || res.status === 403 };
  const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  return { ok: true, accessToken: j.access_token, refreshToken: j.refresh_token ?? null, expiresIn: j.expires_in };
}
