"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { rememberTenant } from "@/lib/session";
import { parseTenantName } from "@/lib/validation";

export type OnboardingState = { error?: string } | null;

export async function createTenant(_prev: OnboardingState, form: FormData): Promise<OnboardingState> {
  const name = parseTenantName(form.get("name"));
  if (!name) return { error: "Enter a name of 1 to 120 characters." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_tenant", { p_name: name });
  if (error || typeof data !== "string") return { error: "We could not create the workspace. Please try again." };
  await rememberTenant(data);
  redirect("/portfolio");
}
