"use server";

import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/session";
import { parseAboutYou } from "@/lib/onboarding";
import { completeOnboarding } from "../complete";

export type AboutState = { error?: string } | null;

/**
 * About you. "Save" keeps the answers in the person's own profile, "Skip" keeps nothing. Someone who created the workspace goes on to
 * the Team step (setup is finished there); someone who joined by invitation is finished here and opens the roadmap.
 */
export async function finishOnboarding(_prev: AboutState, form: FormData): Promise<AboutState> {
  const { supabase, user, active } = await requireWorkspace("/onboarding/about");
  if (active.isDemoAccount || active.platform) redirect("/portfolio");
  const invited = form.get("flow") === "invited";
  const skip = form.get("intent") === "skip";
  const parsed = skip ? null : parseAboutYou({ fullName: form.get("full_name"), role: form.get("role"), goal: form.get("goal") });
  if (parsed && !parsed.ok) return { error: parsed.error };
  const extra: Record<string, unknown> = {};
  if (parsed?.ok) {
    if (parsed.value.fullName) extra.full_name = parsed.value.fullName;
    if (parsed.value.role) extra.role_title = parsed.value.role;
    if (parsed.value.goal) extra.first_goal = parsed.value.goal;
  }
  if (invited) {
    const done = await completeOnboarding(supabase, user, active, { invited: true, extra });
    if (done.error) return { error: done.error };
    redirect("/portfolio");
  }
  if (Object.keys(extra).length) {
    const { error } = await supabase.auth.updateUser({ data: extra });
    if (error) return { error: "We could not save that. Please try again." };
  }
  redirect("/onboarding/invite");
}
