import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseEnv } from "@/lib/supabase/env";
import { refusalFor, type ConnectionStatus, type UsageResult } from "@pv/domain";
import { siteUrl } from "@/lib/site-url";
import { makeReader } from "./reader";
import type { McpBackend } from "./rpc";

/** The /mcp switch. Off unless MCP_ENABLED=true (tenant switch comes with slice 2). */
export const mcpEnabled = () => process.env.MCP_ENABLED === "true";

/**
 * Client that acts as the caller: the caller's own access token goes in the
 * Authorization header, so row-level security applies. The anon key is the
 * public one; the service role is never used on this path.
 */
export function clientFor(token: string) {
  const { url, anonKey } = supabaseEnv();
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type McpCaller = { userId: string; clientId: string; connectionId: string; backend: McpBackend };

export type AuthResult =
  | { ok: true; caller: McpCaller }
  | { ok: false; http: 401 | 403; error: string; message: string };

const unauthorized: AuthResult = {
  ok: false,
  http: 401,
  error: "invalid_token",
  message: "Sign in again: this connection is missing, expired or revoked.",
};

/**
 * Accepts only access tokens issued by the OAuth server (they carry a client_id
 * claim) and checks them with Supabase Auth, so revoked or expired tokens fail.
 * A normal browser session token is refused here. Then the database decides, with
 * the caller's own token, whether the connection is live, the workspace has Claude
 * switched on and the person is still a member (`mcp_authorize`, migration 0043).
 */
export async function authenticate(token: string): Promise<AuthResult> {
  const supabase = clientFor(token);
  const { data: u, error } = await supabase.auth.getUser(token);
  if (error || !u.user) return unauthorized;
  const { data: c } = await supabase.auth.getClaims(token);
  const clientId = typeof c?.claims?.client_id === "string" ? c.claims.client_id : null;
  if (!clientId) return unauthorized;

  const { data: rows, error: ae } = await supabase.rpc("mcp_authorize");
  const a = (rows as { status: ConnectionStatus; connection_id: string | null; tenant_id: string | null; tenant_name: string | null; role: string | null }[] | null)?.[0];
  if (ae || !a) return { ok: false, http: 401, error: "invalid_token", message: "Could not check this connection. Try again." };
  const refusal = refusalFor(a.status);
  if (refusal) return { ok: false, ...refusal };
  const connectionId = a.connection_id!;
  const tenantId = a.tenant_id!;
  const tenantName = a.tenant_name ?? "Workspace";
  const role = a.role!;

  const read = makeReader(supabase, { id: tenantId, name: tenantName }, u.user.id, role, siteUrl);
  return {
    ok: true,
    caller: {
      userId: u.user.id,
      clientId,
      connectionId,
      backend: {
        role,
        async meter(items, bytes): Promise<UsageResult> {
          const { data, error: me } = await supabase.rpc("mcp_record_call", { p_connection: connectionId, p_items: items, p_bytes: bytes });
          if (me || !data) throw new Error("usage");
          return data as UsageResult;
        },
        workspaceContext: read.workspaceContext,
        read: read.reader,
      },
    },
  };
}
