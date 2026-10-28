"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { rememberTenant } from "@/lib/session";
import { parseTenantName } from "@/lib/validation";
import { parseWorkspaceProfile } from "@/lib/workspace-profile";
import { domainOfEmail, isFreeMailDomain } from "@pv/domain";

export type OnboardingState = { error?: string } | null;

export async function createTenant(_prev: OnboardingState, form: FormData): Promise<OnboardingState> {
  const name = parseTenantName(form.get("name"));
  if (!name) return { error: "Enter a name of 1 to 120 characters." };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const domain = auth.user?.email ? domainOfEmail(auth.user.email) : null;
  // a work address means at least one authorized domain (FR-1.2); a personal address may start without one
  const profile = parseWorkspaceProfile(form, { requireDomain: !!domain && !isFreeMailDomain(domain) });
  if ("error" in profile) return { error: profile.error };
  const { data, error } = await supabase.rpc("create_tenant", {
    p_name: name, p_country: profile.country, p_currency: profile.currency, p_time_zone: profile.timeZone, p_domains: profile.domains,
  });
  if (error || typeof data !== "string") return { error: "We could not create the workspace. Please try again." };
  await rememberTenant(data);
  redirect("/portfolio");
}
