"use server";

import { requireWorkspace } from "@/lib/session";
import { readTickedEpics } from "@/lib/atlassian/read-epics";
import { ReconnectNeeded } from "@/lib/atlassian/token-provider";

export type RefreshEpicsResult = { ok: true; projects: number; epics: number; failed: number; truncated: boolean } | { ok: false; error: string };

/**
 * "Read epics now" on Incoming, Epics: reads the open epics of the projects ticked under Settings, Integrations, Jira. Read only (nothing is written to
 * Jira). Creators and admins who are people; Claude, service accounts and platform staff cannot (this is a UI server action).
 */
export async function refreshEpics(): Promise<RefreshEpicsResult> {
  const { supabase, user, active } = await requireWorkspace("/incoming");
  const { data: me } = await supabase.from("tenant_members").select("is_service_account").eq("tenant_id", active.tenantId).eq("user_id", user.id).maybeSingle();
  if (!["creator", "admin"].includes(active.role) || me?.is_service_account || active.platform) return { ok: false, error: "Only creators and admins can read epics from Jira." };
  try {
    return { ok: true, ...(await readTickedEpics(active.tenantId)) };
  } catch (e) {
    if (e instanceof ReconnectNeeded) return { ok: false, error: "Jira needs a new sign-in. A workspace admin can sign in again under Settings > Integrations > Jira." };
    return { ok: false, error: "Jira could not be read just now. Try again in a minute." };
  }
}
