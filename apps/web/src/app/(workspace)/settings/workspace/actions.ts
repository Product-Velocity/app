"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/session";
import { parseTenantName } from "@/lib/validation";
import { parseWorkspaceProfile } from "@/lib/workspace-profile";
import { projectErrorText } from "@/lib/projects/manage";
import { supabaseFileStore } from "@/lib/files/store";

export type WorkspaceState = { error?: string; saved?: boolean } | null;

/** Account Settings for the organisation (FR-1.2): name, country, currency, time zone and authorized email domains. Admins only; audited by the database. */
export async function saveWorkspace(_prev: WorkspaceState, form: FormData): Promise<WorkspaceState> {
  const { supabase, active } = await requireWorkspace("/settings/workspace");
  if (active.role !== "admin") return { error: "Only admins can change workspace settings." };
  const name = parseTenantName(form.get("name"));
  if (!name) return { error: "Enter a name of 1 to 120 characters." };
  const profile = parseWorkspaceProfile(form, { requireDomain: false });
  if ("error" in profile) return { error: profile.error };
  const { data, error } = await supabase
    .from("tenants")
    .update({ name, country: profile.country, currency: profile.currency, time_zone: profile.timeZone, allowed_email_domains: profile.domains, company_url: profile.companyUrl, restrict_invites_to_domains: form.get("restrict_invites") === "on", auto_join_authorized_domains: form.get("auto_join") === "on" })
    .eq("id", active.tenantId)
    .select("id");
  if (error?.code === "PV011") return { error: "Free email providers such as gmail.com cannot be authorized domains." };
  if (error?.code === "PV010") return { error: "One of the domains is not valid. Write it like acme.com." };
  if (error || !data?.length) return { error: "We could not save the settings." };
  revalidatePath("/settings/workspace");
  revalidatePath("/", "layout");
  return { saved: true };
}

export type ProjectState = { error?: string; ok?: string; project?: string } | null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Renames a project (issue #526). A human admin only: the database function refuses everyone else, Claude included. */
export async function renameProject(_prev: ProjectState, form: FormData): Promise<ProjectState> {
  const { supabase, active } = await requireWorkspace("/settings/workspace");
  if (active.role !== "admin" || active.platform) return { error: "Only admins can rename a project.", project: String(form.get("project") ?? "") };
  const project = String(form.get("project") ?? "");
  if (!UUID.test(project)) return { error: "Choose a project.", project };
  const { error } = await supabase.rpc("project_rename", { p_project: project, p_name: String(form.get("name") ?? "") });
  if (error) return { error: projectErrorText(error.code, "rename"), project };
  revalidatePath("/settings/workspace");
  revalidatePath("/", "layout");
  return { ok: "Renamed. Labels and names already written to Jira or GitHub change at the next Sync.", project };
}

/**
 * The coins a new alignment vote starts with for this project (issue #746): the total per person and the most on one initiative. A new session takes them
 * when all its initiatives belong to this project; a session already open keeps its own. A human admin only: the database function refuses everyone else.
 */
export async function setProjectAlignmentDefaults(_prev: ProjectState, form: FormData): Promise<ProjectState> {
  const { supabase, active } = await requireWorkspace("/settings/workspace");
  const project = String(form.get("project") ?? "");
  if (active.role !== "admin" || active.platform) return { error: "Only admins can change a project.", project };
  if (!UUID.test(project)) return { error: "Choose a project.", project };
  const total = Number(form.get("coins_total")), max = Number(form.get("coins_max"));
  if (!Number.isInteger(total) || total < 10 || total > 1000) return { error: "Coins per person must be a whole number from 10 to 1000.", project };
  if (!Number.isInteger(max) || max < 1 || max > total) return { error: "The most on one initiative must be at least 1 and no more than the coins per person.", project };
  const { error } = await supabase.rpc("project_alignment_defaults_set", { p_project: project, p_total: total, p_max: max });
  if (error) return { error: error.code === "42501" ? "Only admins can change a project." : "We could not save the coins.", project };
  revalidatePath("/settings/workspace");
  return { ok: "Saved. New votes for this project start with these coins.", project };
}

/**
 * Deletes a project with its initiatives and all their data (issue #526), after the typed name matches. The database follows the deletion process
 * (Trash, then deleted for good, then the project) in one transaction; the bytes of the files are removed from storage afterwards. Jira and GitHub are never written.
 */
export async function deleteProject(_prev: ProjectState, form: FormData): Promise<ProjectState> {
  const { supabase, active } = await requireWorkspace("/settings/workspace");
  const project = String(form.get("project") ?? "");
  if (active.role !== "admin" || active.platform) return { error: "Only admins can delete a project.", project };
  if (!UUID.test(project)) return { error: "Choose a project.", project };
  const { data, error } = await supabase.rpc("project_delete", { p_project: project, p_confirm_name: String(form.get("confirm") ?? "") });
  if (error) return { error: projectErrorText(error.code, "delete"), project };
  const r = (data ?? {}) as { initiatives?: number; files?: string[] };
  let removed = 0;
  let failed = 0;
  const paths = Array.isArray(r.files) ? r.files.filter((x): x is string => typeof x === "string").slice(0, 5000) : [];
  if (paths.length > 0) {
    const store = supabaseFileStore();
    for (const path of paths) { try { await store.remove(path); removed++; } catch { failed++; } }
  }
  revalidatePath("/settings/workspace");
  revalidatePath("/", "layout");
  const n = r.initiatives ?? 0;
  return { ok: `Deleted the project and ${n} initiative${n === 1 ? "" : "s"}${paths.length > 0 ? `, and ${removed} of ${paths.length} stored file${paths.length === 1 ? "" : "s"}${failed > 0 ? ` (${failed} could not be removed from storage; they are no longer reachable from the app)` : ""}` : ""}. Jira and GitHub were not changed.`, project };
}
