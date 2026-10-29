// Atlassian OAuth 2.0 (3LO). Spike J1 (#257): only what is needed to connect once and read. Tokens are not stored.
export const AUTHORIZE_URL = "https://auth.atlassian.com/authorize";
export const TOKEN_URL = "https://auth.atlassian.com/oauth/token";
export const API_BASE = "https://api.atlassian.com";

/** Smallest list that lets the spike read and write issues; `offline_access` is what returns a refresh token. */
export const JIRA_SCOPES = ["read:jira-work", "read:jira-user", "write:jira-work", "offline_access"];
/** Added only when the person asks to test Confluence publishing (#258). Names to be confirmed against a real site. */
export const CONFLUENCE_SCOPES = ["write:confluence-content", "read:confluence-space.summary", "read:confluence-content.summary"];

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
