"use server";

import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/session";
import { hasFinishedOnboarding, parseAboutYou, withOnboarded } from "@/lib/onboarding";
import { notifyNewWorkspace } from "@/lib/new-workspace-notice";

export type AboutState = { error?: string } | null;

/**
 * Last step of the wizard. "Save" keeps the answers in the person's own profile, "Skip" keeps nothing; both finish setup. Finishing a
 * workspace for the first time tells the product owner (best effort, once per workspace).
 */
export async function finishOnboarding(_prev: AboutState, form: FormData): Promise<AboutState> {
  const { supabase, user, active } = await requireWorkspace("/onboarding/about");
  if (active.isDemoAccount || active.platform) redirect("/portfolio");
  const skip = form.get("intent") === "skip";
  const parsed = skip ? null : parseAboutYou({ fullName: form.get("full_name"), role: form.get("role"), goal: form.get("goal") });
  if (parsed && !parsed.ok) return { error: parsed.error };
  const invited = form.get("flow") === "invited";
  const first = !hasFinishedOnboarding(user.user_metadata, active.tenantId);
  const data: Record<string, unknown> = { onboarded_tenants: withOnboarded(user.user_metadata, active.tenantId) };
  if (parsed?.ok) {
    if (parsed.value.fullName) data.full_name = parsed.value.fullName;
    if (parsed.value.role) data.role_title = parsed.value.role;
    if (parsed.value.goal) data.first_goal = parsed.value.goal;
  }
  const { error } = await supabase.auth.updateUser({ data });
  if (error) return { error: "We could not save that. Please try again." };
  // only the person who created the workspace: not someone invited into it, even as admin (the form says which flow, the member count confirms)
  const { count: members } = invited || !first || active.role !== "admin" ? { count: 0 } : await supabase.from("tenant_members").select("id", { count: "exact", head: true }).eq("tenant_id", active.tenantId).eq("is_service_account", false);
  if (members === 1) await notifyNewWorkspace({ tenantId: active.tenantId, workspace: active.tenantName, email: user.email });
  redirect("/portfolio");
}
