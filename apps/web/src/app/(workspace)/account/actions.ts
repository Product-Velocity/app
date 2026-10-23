"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { canUnlink, LINKABLE, signedInRecently, validateProfile } from "@/lib/account";
import { checkPassword } from "@/lib/password";
import { loadMemberships, requireUser } from "@/lib/session";
import { siteUrl } from "@/lib/site-url";

export type FormState = { ok?: string; error?: string } | null;
const PATH = "/account";

/**
 * Changing an email or a password asks for the current password. A person who only signs in with Google or GitHub has none, so they
 * need to have signed in within the last 15 minutes instead.
 */
async function reauthenticate(supabase: SupabaseClient, user: User, password: string): Promise<string | null> {
  const hasPassword = (user.identities ?? []).some((i) => i.provider === "email");
  if (hasPassword) {
    if (!password) return "Enter your current password.";
    const { error } = await supabase.auth.signInWithPassword({ email: user.email ?? "", password });
    return error ? "That is not your current password." : null;
  }
  return signedInRecently(user.last_sign_in_at) ? null : "For your safety, sign out and sign in again, then try this within 15 minutes.";
}

export async function saveProfile(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireUser(PATH);
  const v = validateProfile({ fullName: form.get("full_name"), language: form.get("language"), timeZone: form.get("time_zone"), dateFormat: form.get("date_format") });
  if (!v.ok) return { error: v.error };
  const { error } = await supabase.auth.updateUser({ data: { full_name: v.profile.fullName, language: v.profile.language, time_zone: v.profile.timeZone, date_format: v.profile.dateFormat } });
  if (error) return { error: "We could not save your profile. Please try again." };
  revalidatePath(PATH);
  return { ok: "Saved." };
}

export async function changeEmail(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, user } = await requireUser(PATH);
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { error: "Enter a valid email address." };
  if (email === (user.email ?? "").toLowerCase()) return { error: "That is already your email address." };
  const why = await reauthenticate(supabase, user, String(form.get("current_password") ?? ""));
  if (why) return { error: why };
  const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: `${await siteUrl()}/auth/callback?next=${encodeURIComponent(PATH)}` });
  if (error) return { error: "We could not start the change. The address may already be in use." };
  return { ok: `We sent a confirmation link to ${email}. Your email changes when you open it.` };
}

export async function changePassword(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, user } = await requireUser(PATH);
  const next = String(form.get("new_password") ?? "");
  const check = checkPassword(next, { email: user.email ?? undefined });
  if (!check.ok) return { error: "The new password is too weak: " + check.requirements.filter((r) => !r.met).map((r) => r.label).join("; ") + "." };
  const why = await reauthenticate(supabase, user, String(form.get("current_password") ?? ""));
  if (why) return { error: why };
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return { error: "We could not change your password. Please try again." };
  return { ok: "Password changed." };
}

export async function linkProvider(form: FormData): Promise<void> {
  const { supabase } = await requireUser(PATH);
  const provider = String(form.get("provider"));
  if (!(LINKABLE as readonly string[]).includes(provider)) redirect(`${PATH}?status=bad-provider`);
  const { data, error } = await supabase.auth.linkIdentity({ provider: provider as "google" | "github", options: { redirectTo: `${await siteUrl()}/auth/callback?next=${encodeURIComponent(PATH)}` } });
  if (error || !data?.url) redirect(`${PATH}?status=link-failed`);
  redirect(data.url);
}

export async function unlinkProvider(form: FormData): Promise<void> {
  const { supabase } = await requireUser(PATH);
  const provider = String(form.get("provider"));
  const { data } = await supabase.auth.getUserIdentities();
  const identities = data?.identities ?? [];
  if (!canUnlink(identities, provider)) redirect(`${PATH}?status=last-method`);
  const identity = identities.find((i) => i.provider === provider)!;
  const { error } = await supabase.auth.unlinkIdentity(identity);
  revalidatePath(PATH);
  redirect(`${PATH}?status=${error ? "unlink-failed" : "unlinked"}`);
}

/** Signs the person out of every other device (scope "others"), or of everything including this browser (scope "global"). */
export async function signOutSessions(form: FormData): Promise<void> {
  const { supabase } = await requireUser(PATH);
  const scope = form.get("scope") === "global" ? "global" : "others";
  await supabase.auth.signOut({ scope });
  if (scope === "global") redirect("/sign-in");
  redirect(`${PATH}?status=signed-out-others`);
}

export async function leaveWorkspace(form: FormData): Promise<void> {
  const { supabase, user } = await requireUser(PATH);
  const tenantId = String(form.get("tenant_id"));
  const memberships = await loadMemberships(supabase, user.id);
  if (!memberships.some((m) => m.tenantId === tenantId)) redirect(`${PATH}?status=leave-failed`);
  const { error } = await supabase.from("tenant_members").delete().eq("tenant_id", tenantId).eq("user_id", user.id);
  revalidatePath(PATH);
  if (error) redirect(`${PATH}?status=${error.code === "PV003" ? "last-admin" : "leave-failed"}`);
  redirect(`${PATH}?status=left`);
}
