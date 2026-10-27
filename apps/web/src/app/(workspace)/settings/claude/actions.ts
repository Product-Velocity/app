"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/session";

const PATH = "/settings/claude";
const back = (status: string): never => redirect(`${PATH}?status=${status}`);

/** Workspace admins switch Claude on or off for the whole workspace. RLS allows admins only; the change is audited. */
export async function setClaudeEnabled(formData: FormData) {
  const { supabase, active } = await requireWorkspace(PATH);
  if (active.role !== "admin") return back("not-admin");
  const enabled = formData.get("enabled") === "on";
  const { error } = await supabase.from("tenants").update({ claude_enabled: enabled }).eq("id", active.tenantId);
  if (error) return back(error.code === "42703" || error.code === "PGRST204" ? "needs-migration" : "failed");
  revalidatePath(PATH);
  return back(enabled ? "switched-on" : "switched-off");
}

/** Revokes a connection. The next call from Claude is refused; the person's own revoke also ends the OAuth grant. */
export async function revokeConnection(formData: FormData) {
  const { supabase } = await requireWorkspace(PATH);
  const id = String(formData.get("id") ?? "");
  const clientId = String(formData.get("client_id") ?? "");
  const own = formData.get("own") === "1";
  const { data, error } = await supabase.rpc("mcp_revoke", { p_id: id });
  if (error) return back("failed");
  if (data && own && clientId) {
    // ends refresh tokens at the OAuth server too; our own check already refuses the next call, so a failure here is not shown
    await supabase.auth.oauth.revokeGrant({ clientId }).catch(() => undefined);
  }
  revalidatePath(PATH);
  return back(data ? "revoked" : "already-revoked");
}
