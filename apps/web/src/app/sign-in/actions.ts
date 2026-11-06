"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/safe-next";
import { siteUrl } from "@/lib/site-url";
import { checkPassword } from "@/lib/password";
import { normalizeEmail } from "@/lib/validation";
import { resolveSignInEmail } from "@/lib/auth/resolve-sign-in-email";

export type AuthState = { error?: string; message?: string } | null;

/** Result of "Email me a sign-in link". `sent` is true for every valid-looking address, so the answer never says whether an account exists. */
export type LinkState = { sent: boolean; email: string; nonce: number; error?: string } | null;

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
  // R-111 FR-4.2: a verified linked address opens the same person. Anything unknown stays as typed, so the answer never differs.
  const signInEmail = await resolveSignInEmail(email);
  const { error } = await supabase.auth.signInWithPassword({ email: signInEmail, password });
  if (error) {
    // same wording for unknown email, wrong password and unconfirmed email
    return { error: "Email or password is incorrect, or the email is not confirmed yet." };
  }
  redirect(next);
}

/**
 * One-time emailed sign-in link for an EXISTING account.
 * - `shouldCreateUser: false`: this can never create an account.
 * - The reply is identical for unknown addresses, send errors and rate limits
 *   (Supabase allows one email per address per minute, plus a project hourly cap),
 *   so nobody can probe which addresses have an account.
 * - A verified linked address opens the same person (R-111), as password sign-in does.
 * - Two-factor still applies after the link: the app sends the person to /mfa.
 */
export async function sendSignInLink(_prev: LinkState, form: FormData): Promise<LinkState> {
  const email = normalizeEmail(form.get("email"));
  const next = safeNext(form.get("next") as string | null);
  if (!email) return { sent: false, email: "", nonce: Date.now(), error: "Enter your email address first." };
  try {
    const supabase = await createClient();
    const target = await resolveSignInEmail(email);
    await supabase.auth.signInWithOtp({
      email: target,
      options: { shouldCreateUser: false, emailRedirectTo: await callbackUrl(next) },
    });
  } catch {
    // same answer on any failure
  }
  return { sent: true, email, nonce: Date.now() };
}

export async function signUp(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = normalizeEmail(form.get("email"));
  const password = form.get("password");
  const next = safeNext(form.get("next") as string | null);
  if (!email) return { error: "Enter a valid email address." };
  if (typeof password !== "string" || !checkPassword(password, { email }).ok) {
    return { error: "Choose a stronger password: follow the checklist under the password field." };
  }
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
