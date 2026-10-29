"use server";

import { revalidatePath } from "next/cache";
import { checkProfileSections, mergeSections, PROFILE_SECTION_KEYS } from "@pv/domain";
import { requireWorkspace } from "@/lib/session";

export type ProfileState = { error?: string; saved?: string } | null;

const PATH = "/settings/company-profile";

/** Saves the profile sections as they are in the form (admins only; audited and versioned by the database). */
export async function saveProfile(_prev: ProfileState, form: FormData): Promise<ProfileState> {
  const { supabase, active } = await requireWorkspace(PATH);
  if (active.role !== "admin") return { error: "Only workspace admins can change the company profile." };
  const input: Record<string, string> = {};
  for (const k of PROFILE_SECTION_KEYS) input[k] = String(form.get(k) ?? "");
  const c = checkProfileSections(input);
  if (!c.ok) return { error: c.error };
  const sections = mergeSections({}, c.value) as Record<string, string>;
  const version = Number(form.get("version"));
  if (!Number.isInteger(version) || version < 1) {
    const { error } = await supabase.from("company_profiles").insert({ tenant_id: active.tenantId, sections });
    if (error) return { error: error.code === "23505" ? "Someone saved a profile in the meantime. Reload the page." : "We could not save the profile." };
  } else {
    const { data, error } = await supabase.from("company_profiles").update({ sections }).eq("tenant_id", active.tenantId).eq("version", version).select("version");
    if (error) return { error: "We could not save the profile." };
    if (!data?.length && !(await unchanged(supabase, active.tenantId, sections))) return { error: "Someone else (or Claude) changed the profile since you opened it. Reload the page and apply your edits again." };
  }
  revalidatePath(PATH);
  return { saved: "Saved." };
}

/** An unchanged save writes no new version, so no row comes back; that is not a conflict. */
async function unchanged(supabase: Awaited<ReturnType<typeof requireWorkspace>>["supabase"], tenantId: string, sections: Record<string, string>): Promise<boolean> {
  const { data } = await supabase.from("company_profiles").select("sections").eq("tenant_id", tenantId).maybeSingle();
  return JSON.stringify(sortKeys((data as { sections: Record<string, string> } | null)?.sections ?? {})) === JSON.stringify(sortKeys(sections));
}
const sortKeys = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

/** An admin confirms (or reopens) the profile. Claude never can: the database refuses it. */
export async function setProfileStatus(_prev: ProfileState, form: FormData): Promise<ProfileState> {
  const { supabase, active } = await requireWorkspace(PATH);
  if (active.role !== "admin") return { error: "Only workspace admins can confirm the company profile." };
  const status = form.get("status") === "confirmed" ? "confirmed" : "draft";
  const { data, error } = await supabase.from("company_profiles").update({ status }).eq("tenant_id", active.tenantId).select("status");
  if (error || !data?.length) return { error: "We could not change the status." };
  revalidatePath(PATH);
  return { saved: status === "confirmed" ? "Confirmed. Claude will use this when writing Discovery and PRD documents." : "Reopened as a draft." };
}
