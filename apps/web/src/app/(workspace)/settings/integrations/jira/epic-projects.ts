"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/session";

const PATH = "/settings/integrations/jira";

/** Saves the Jira projects ticked under "Projects to check for epics" for one connection and site. Workspace admins who are people (the database checks it too). */
export async function saveEpicProjects(form: FormData): Promise<void> {
  const { supabase, active } = await requireWorkspace(PATH);
  const connection = String(form.get("connection") ?? "");
  const site = String(form.get("site") ?? "");
  const keys = [...new Set(form.getAll("key").map((k) => String(k)))];
  let status = "epics-saved";
  if (active.role !== "admin" || active.platform) status = "not-admin";
  else {
    const { error } = await supabase.rpc("jira_set_epic_projects", { p_connection: connection, p_site: site, p_keys: keys });
    if (error) status = error.code === "42501" ? "not-admin" : "epics-error";
  }
  revalidatePath(PATH);
  revalidatePath("/incoming");
  redirect(`${PATH}?status=${status}`);
}
