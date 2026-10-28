import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseEnv } from "@/lib/supabase/env";
import { refusalFor, type ConnectionStatus, type UsageResult } from "@pv/domain";
import { siteUrl } from "@/lib/site-url";
import { makeReader } from "./reader";
import type { Unavailable, WorkspaceHandle } from "./multi";

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

/** The person, the OAuth client, and one handle per workspace the connection covers and the database said is usable. */
export type McpCaller = { userId: string; clientId: string; workspaces: WorkspaceHandle[]; unavailable: Unavailable[] };

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

  const { data: rows, error: ae } = await supabase.rpc("mcp_authorize_all");
  type Row = { status: ConnectionStatus; connection_id: string | null; tenant_id: string | null; tenant_name: string | null; role: string | null; last_write_at: string | null };
  const list = (rows as Row[] | null) ?? [];
  if (ae || list.length === 0) return { ok: false, http: 401, error: "invalid_token", message: "Could not check this connection. Try again." };
  const usable = list.filter((r) => r.status === "ok");
  if (usable.length === 0) {
    // nothing usable: say why, using the first reason (they are all about the same connection)
    const refusal = refusalFor(list[0]!.status);
    return refusal ? { ok: false, ...refusal } : unauthorized;
  }

  const workspaces: WorkspaceHandle[] = usable.map((a) => {
    const connectionId = a.connection_id!;
    const name = a.tenant_name ?? "Workspace";
    const role = a.role!;
    const read = makeReader(supabase, { id: a.tenant_id!, name }, u.user.id, role, siteUrl);
    return {
      id: a.tenant_id!,
      name,
      role,
      lastWriteAt: a.last_write_at,
      backend: {
        role,
        async meter(items, bytes, write): Promise<UsageResult> {
          const { data, error: me } = await supabase.rpc("mcp_record_call", { p_connection: connectionId, p_items: items, p_bytes: bytes, p_write: write === true });
          if (me || !data) throw new Error("usage");
          return data as UsageResult;
        },
        workspaceContext: read.workspaceContext,
        read: read.reader,
        write: read.writer,
      },
    };
  });
  const unavailable = list.filter((r) => r.status !== "ok").map((r) => ({ name: r.tenant_name ?? "Workspace", status: r.status }));
  return { ok: true, caller: { userId: u.user.id, clientId, workspaces, unavailable } };
}
