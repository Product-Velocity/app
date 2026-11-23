import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { hasFinishedOnboarding, withOnboarded } from "@/lib/onboarding";
import { notifyNewWorkspace } from "@/lib/new-workspace-notice";

/**
 * Marks the wizard finished for this workspace in the person's own profile. The first time, and only for the person who created the
 * workspace (an admin who is its only member; never someone invited, even as admin), it tells the product owner. Best effort.
 */
export async function completeOnboarding(supabase: SupabaseClient, user: User, active: { tenantId: string; tenantName: string; role: string }, opts: { invited: boolean; extra?: Record<string, unknown> }): Promise<{ error?: string }> {
  const first = !hasFinishedOnboarding(user.user_metadata, active.tenantId);
  const { error } = await supabase.auth.updateUser({ data: { ...opts.extra, onboarded_tenants: withOnboarded(user.user_metadata, active.tenantId) } });
  if (error) return { error: "We could not save that. Please try again." };
  if (first && !opts.invited && active.role === "admin") {
    const { count } = await supabase.from("tenant_members").select("id", { count: "exact", head: true }).eq("tenant_id", active.tenantId).eq("is_service_account", false);
    if (count === 1) await notifyNewWorkspace({ tenantId: active.tenantId, workspace: active.tenantName, email: user.email });
  }
  return {};
}
