"use server";

import { redirect } from "next/navigation";
import { loadMemberships, rememberTenant, requireUser } from "@/lib/session";

export async function switchTenant(form: FormData) {
  const tenantId = form.get("tenantId");
  const { supabase, user } = await requireUser("/home");
  const memberships = await loadMemberships(supabase, user.id);
  // only tenants the user belongs to can be selected
  if (typeof tenantId === "string" && memberships.some((m) => m.tenantId === tenantId)) {
    await rememberTenant(tenantId);
    redirect(`/w/${tenantId}/portfolio`);
  }
  redirect("/portfolio");
}
