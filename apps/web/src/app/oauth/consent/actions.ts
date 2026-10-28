"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const again = (id: string, error: string): never => redirect(`/oauth/consent?authorization_id=${encodeURIComponent(id)}&error=${error}`);

/**
 * Approve or deny. On approve the person's chosen workspaces (one or several) are bound to this client first (`mcp_connect_many`, which
 * refuses a workspace that is not theirs, has Claude switched off or allows Claude only on its own), then the OAuth server is told. The client's id and name
 * are read again from the OAuth server, never taken from the form.
 */
export async function decide(formData: FormData) {
  const id = String(formData.get("authorization_id") ?? "");
  const approve = formData.get("decision") === "approve";
  if (!id) redirect("/");
  const supabase = await createClient();

  if (approve) {
    const tenants = [...new Set(formData.getAll("tenant_id").map(String).filter(Boolean))];
    if (tenants.length === 0) return again(id, "choose");
    const { data: details } = await supabase.auth.oauth.getAuthorizationDetails(id);
    if (!details || !("client" in details)) return again(id, "1");
    // one approval can cover several workspaces (R-115, migration 0058); an older database only knows one
    let { error: ce } = await supabase.rpc("mcp_connect_many", { p_tenants: tenants, p_client_id: details.client.id, p_client_name: details.client.name });
    if (ce && (ce.code === "PGRST202" || ce.code === "42883")) {
      if (tenants.length > 1) return again(id, "needs-migration");
      ({ error: ce } = await supabase.rpc("mcp_connect", { p_tenant: tenants[0], p_client_id: details.client.id, p_client_name: details.client.name }));
    }
    if (ce) return again(id, ce.message.includes("claude_disabled") ? "off" : ce.message.includes("single_only") ? "single" : "1");
  }

  const { data, error } = approve
    ? await supabase.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true })
    : await supabase.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true });
  if (error || !data) return again(id, "1");
  redirect(data.redirect_url);
}
