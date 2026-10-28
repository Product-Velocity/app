"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/session";
import { parseTenantName } from "@/lib/validation";
import { parseWorkspaceProfile } from "@/lib/workspace-profile";

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
    .update({ name, country: profile.country, currency: profile.currency, time_zone: profile.timeZone, allowed_email_domains: profile.domains, restrict_invites_to_domains: form.get("restrict_invites") === "on" })
    .eq("id", active.tenantId)
    .select("id");
  if (error?.code === "PV011") return { error: "Free email providers such as gmail.com cannot be authorized domains." };
  if (error?.code === "PV010") return { error: "One of the domains is not valid. Write it like acme.com." };
  if (error || !data?.length) return { error: "We could not save the settings." };
  revalidatePath("/settings/workspace");
  revalidatePath("/", "layout");
  return { saved: true };
}
