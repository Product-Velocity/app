import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseEnv } from "@/lib/supabase/env";
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

export type McpCaller = { userId: string; clientId: string; backend: McpBackend };

/**
 * Accepts only access tokens issued by the OAuth server (they carry a client_id
 * claim) and checks them with Supabase Auth, so revoked or expired tokens fail.
 * A normal browser session token is refused here.
 */
export async function authenticate(token: string): Promise<McpCaller | null> {
  const supabase = clientFor(token);
  const { data: u, error } = await supabase.auth.getUser(token);
  if (error || !u.user) return null;
  const { data: c } = await supabase.auth.getClaims(token);
  const clientId = typeof c?.claims?.client_id === "string" ? c.claims.client_id : null;
  if (!clientId) return null;

  return {
    userId: u.user.id,
    clientId,
    backend: {
      async workspaceContext() {
        const { data, error: e } = await supabase
          .from("tenant_members")
          .select("role, tenants(id, name)")
          .eq("user_id", u.user.id);
        if (e) throw new Error("memberships");
        const rows = (data ?? []).flatMap((r) => {
          const t = r.tenants as unknown as { id: string; name: string } | { id: string; name: string }[] | null;
          const tenant = Array.isArray(t) ? t[0] : t;
          return tenant ? [{ id: tenant.id, name: tenant.name, role: r.role as string }] : [];
        });
        const { data: projects, error: pe } = await supabase.from("projects").select("id, name, tenant_id").order("name");
        if (pe) throw new Error("projects");
        return {
          name: null,
          workspaces: rows.map((w) => ({
            ...w,
            projects: (projects ?? []).filter((p) => p.tenant_id === w.id).map((p) => ({ id: p.id as string, name: p.name as string })),
          })),
        };
      },
    },
  };
}
