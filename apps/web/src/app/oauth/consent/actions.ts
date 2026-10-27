"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const again = (id: string, error: string): never => redirect(`/oauth/consent?authorization_id=${encodeURIComponent(id)}&error=${error}`);

/**
 * Approve or deny. On approve the person's chosen workspace is bound to this client first (`mcp_connect`, which refuses
 * a workspace that is not theirs or has Claude switched off), then the OAuth server is told. The client's id and name
 * are read again from the OAuth server, never taken from the form.
 */
export async function decide(formData: FormData) {
  const id = String(formData.get("authorization_id") ?? "");
  const approve = formData.get("decision") === "approve";
  if (!id) redirect("/");
  const supabase = await createClient();

  if (approve) {
    const tenant = String(formData.get("tenant_id") ?? "");
    if (!tenant) return again(id, "choose");
    const { data: details } = await supabase.auth.oauth.getAuthorizationDetails(id);
    if (!details || !("client" in details)) return again(id, "1");
    const { error: ce } = await supabase.rpc("mcp_connect", {
      p_tenant: tenant,
      p_client_id: details.client.id,
      p_client_name: details.client.name,
    });
    if (ce) return again(id, ce.message.includes("claude_disabled") ? "off" : "1");
  }

  const { data, error } = approve
    ? await supabase.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true })
    : await supabase.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true });
  if (error || !data) return again(id, "1");
  redirect(data.redirect_url);
}
