"use server";

import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/session";
import { hasFinishedOnboarding } from "@/lib/onboarding";
import { completeOnboarding } from "../complete";
import { sendWelcome } from "@/lib/founder-emails";

/** "Continue" or "Skip" on the Team step: setup is finished here. The person who created the workspace is the owner's one email. */
export async function finishSetup(): Promise<void> {
  const { supabase, user, active } = await requireWorkspace("/onboarding/invite");
  if (active.isDemoAccount || active.platform) redirect("/portfolio");
  const first = !hasFinishedOnboarding(user.user_metadata, active.tenantId);
  await completeOnboarding(supabase, user, active, { invited: false }); // a failed save never stops the person
  if (first && active.role === "admin") await sendWelcome({ tenantId: active.tenantId, workspace: active.tenantName, email: user.email, fullName: user.user_metadata?.full_name });
  redirect("/onboarding/connect");
}
