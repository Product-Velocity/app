"use server";

import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/session";
import { completeOnboarding } from "../complete";

/** "Continue" or "Skip" on the Team step: setup is finished here. The person who created the workspace is the owner's one email. */
export async function finishSetup(): Promise<void> {
  const { supabase, user, active } = await requireWorkspace("/onboarding/invite");
  if (active.isDemoAccount || active.platform) redirect("/portfolio");
  await completeOnboarding(supabase, user, active, { invited: false }); // a failed save never stops the person
  redirect("/onboarding/connect");
}
