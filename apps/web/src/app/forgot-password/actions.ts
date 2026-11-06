"use server";

import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site-url";
import { normalizeEmail } from "@/lib/validation";
import { resolveSignInEmail } from "@/lib/auth/resolve-sign-in-email";
import type { LinkState } from "@/app/sign-in/actions";

/**
 * Emails a one-time link to choose a new password.
 * The reply is the same for every valid-looking address, a send error and a rate limit,
 * so nobody can learn which addresses have an account. The link comes back through
 * /auth/callback (type=recovery) and opens /reset-password.
 */
export async function requestPasswordReset(_prev: LinkState, form: FormData): Promise<LinkState> {
  const email = normalizeEmail(form.get("email"));
  if (!email) return { sent: false, email: "", nonce: Date.now(), error: "Enter your email address first." };
  try {
    const supabase = await createClient();
    const target = await resolveSignInEmail(email);
    await supabase.auth.resetPasswordForEmail(target, {
      redirectTo: `${await siteUrl()}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
    });
  } catch {
    // same answer on any failure
  }
  return { sent: true, email, nonce: Date.now() };
}
