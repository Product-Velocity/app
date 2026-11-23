"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/session";
import { dismissedChecklists } from "@/lib/onboarding";

/** Closes the "Get started" card for this account. Stored in the person's own profile; touches no workspace data. */
export async function dismissGetStarted(): Promise<void> {
  const { supabase, user, active } = await requireWorkspace("/portfolio");
  const list = dismissedChecklists(user.user_metadata);
  if (!list.includes(active.tenantId)) await supabase.auth.updateUser({ data: { checklist_dismissed: [...list, active.tenantId] } });
  revalidatePath("/portfolio");
}
