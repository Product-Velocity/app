"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/safe-next";
import { siteUrl } from "@/lib/site-url";
import { checkPassword } from "@/lib/password";
import { normalizeEmail } from "@/lib/validation";

export type AuthState = { error?: string; message?: string } | null;

const callbackUrl = async (next: string) =>
  `${await siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`;

export async function signInWithPassword(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = normalizeEmail(form.get("email"));
  const password = form.get("password");
  const next = safeNext(form.get("next") as string | null);
  if (!email || typeof password !== "string" || password.length === 0) {
    return { error: "Enter your email and password." };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // same wording for unknown email, wrong password and unconfirmed email
    return { error: "Email or password is incorrect, or the email is not confirmed yet." };
  }
  redirect(next);
}

export async function signUp(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = normalizeEmail(form.get("email"));
  const password = form.get("password");
  const confirm = form.get("confirm");
  const next = safeNext(form.get("next") as string | null);
  if (!email) return { error: "Enter a valid email address." };
  if (typeof password !== "string" || !checkPassword(password, { email }).ok) {
    return { error: "Choose a stronger password: follow the checklist under the password field." };
  }
  if (password !== confirm) return { error: "The two passwords do not match." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: await callbackUrl(next) },
  });
  if (error) return { error: "We could not create that account. Try again or sign in." };
  // identical message whether or not the address already exists
  return { message: "Check your email and follow the link to confirm your address, then sign in." };
}

export async function signInWithProvider(form: FormData): Promise<void> {
  const provider = form.get("provider");
  const next = safeNext(form.get("next") as string | null);
  if (provider !== "google" && provider !== "github") redirect("/sign-in?error=provider");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: await callbackUrl(next) },
  });
  if (error || !data.url) redirect(`/sign-in?error=provider&next=${encodeURIComponent(next)}`);
  redirect(data.url);
}
