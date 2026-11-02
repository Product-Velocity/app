import type { SupabaseClient } from "@supabase/supabase-js";

/** The spike writes to a customer's Jira, so it needs a workspace admin (never a service account). */
export async function isWorkspaceAdmin(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase.from("tenant_members").select("role, is_service_account").eq("user_id", userId).eq("role", "admin").eq("is_service_account", false).limit(1);
  return (data?.length ?? 0) > 0;
}
