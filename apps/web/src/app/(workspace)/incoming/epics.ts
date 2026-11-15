"use server";

import { requireWorkspace } from "@/lib/session";
import { readTickedEpics } from "@/lib/atlassian/read-epics";
import { ReconnectNeeded } from "@/lib/atlassian/token-provider";
import { githubSourceControl } from "@/lib/github/server";
import { readTickedGithubEpics } from "@/lib/github/read-epics";

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

export type RefreshGithubEpicsResult = { ok: true; projects: number; epics: number; failed: number; truncated: boolean } | { ok: false; error: string };

/**
 * "Read epics now" on Incoming, GitHub, Epics: reads the open parent issues of the repositories ticked under Settings, Integrations, GitHub. Read only
 * (nothing is written to GitHub). Creators and admins who are people; Claude, service accounts and platform staff cannot (this is a UI server action).
 * `projects` is the number of repositories read, so the one view serves both trackers.
 */
export async function refreshGithubEpics(): Promise<RefreshGithubEpicsResult> {
  const { supabase, user, active } = await requireWorkspace("/incoming");
  const { data: me } = await supabase.from("tenant_members").select("is_service_account").eq("tenant_id", active.tenantId).eq("user_id", user.id).maybeSingle();
  if (!["creator", "admin"].includes(active.role) || me?.is_service_account || active.platform) return { ok: false, error: "Only creators and admins can read epics from GitHub." };
  const sc = githubSourceControl();
  if (!sc) return { ok: false, error: "The GitHub App is not configured on the server." };
  try {
    const r = await readTickedGithubEpics(active.tenantId, sc);
    return { ok: true, projects: r.repos, epics: r.epics, failed: r.failed, truncated: r.truncated };
  } catch {
    return { ok: false, error: "GitHub could not be read just now. Try again in a minute." };
  }
}
