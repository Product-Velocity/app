"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { rememberTenant } from "@/lib/session";
import { siteUrl } from "@/lib/site-url";
import { checkPassword } from "@/lib/password";
import { getInvitePreview } from "./preview";

/** Same shape as the sign-in page's link result. */
export type { LinkState } from "@/app/sign-in/actions";

export type AcceptState = { error?: string; message?: string } | null;

const NOT_VALID =
  "This invitation is not valid. It may have expired, been used or revoked, or it was sent to a different email address.";

async function accept(supabase: Awaited<ReturnType<typeof createClient>>, token: string): Promise<AcceptState> {
  const { data, error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error) {
    if (error.code === "PV002") return { error: "You are already a member of this workspace." };
    return { error: NOT_VALID };
  }
  await rememberTenant(data as string);
  redirect("/portfolio");
}

const tokenFrom = (form: FormData) => {
  const t = form.get("token");
  return typeof t === "string" && t.length >= 20 && t.length <= 200 ? t : null;
};

/** Signed-in person clicks "Accept". */
export async function acceptInvitation(_prev: AcceptState, form: FormData): Promise<AcceptState> {
  const token = tokenFrom(form);
  if (!token) return { error: NOT_VALID };
  return accept(await createClient(), token);
}

/** Existing account: password sign-in, then accept, in one step. The email is the invited one. */
export async function signInAndAccept(_prev: AcceptState, form: FormData): Promise<AcceptState> {
  const token = tokenFrom(form);
  const password = form.get("password");
  if (!token) return { error: NOT_VALID };
  if (typeof password !== "string" || password.length === 0) return { error: "Enter your password." };

  const supabase = await createClient();
  const preview = await getInvitePreview(supabase, token);
  if (!preview) return { error: NOT_VALID };

  const { error } = await supabase.auth.signInWithPassword({ email: preview.email, password });
  if (error) {
    return {
      error: preview.accountExists
        ? "The password is incorrect, or this account has no password (for example it was created with Google or GitHub). Try again, or continue with Google or GitHub."
        : "There is no account for this email yet. Choose Create account to set a password.",
    };
  }
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    redirect(`/mfa?next=${encodeURIComponent(`/invite/${token}`)}`);
  }
  return accept(supabase, token);
}

/** New account for the invited email. They confirm by email, then come back to accept. */
export async function signUpForInvite(_prev: AcceptState, form: FormData): Promise<AcceptState> {
  const token = tokenFrom(form);
  const password = form.get("password");
  if (!token) return { error: NOT_VALID };
  const supabase = await createClient();
  const preview = await getInvitePreview(supabase, token);
  if (!preview) return { error: NOT_VALID };
  if (typeof password !== "string" || !checkPassword(password, { email: preview.email }).ok) {
    return { error: "Choose a stronger password: follow the checklist under the password field." };
  }

  const next = `/invite/${token}`;
  const { error } = await supabase.auth.signUp({
    email: preview.email,
    password,
    options: { emailRedirectTo: `${await siteUrl()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error) return { error: "We could not create that account. Try again or sign in." };
  return {
    message:
      "Check your email and open the confirmation link, then you will come back here to accept. If you already have an account with this email, use Sign in instead.",
  };
}

/**
 * Existing account, invited address: email a one-time sign-in link that comes back here to accept.
 * Never creates an account; the reply is the same whatever happens.
 */
export async function sendInviteSignInLink(
  _prev: import("@/app/sign-in/actions").LinkState,
  form: FormData,
): Promise<import("@/app/sign-in/actions").LinkState> {
  const token = tokenFrom(form);
  if (!token) return { sent: false, email: "", nonce: Date.now(), error: NOT_VALID };
  const supabase = await createClient();
  const preview = await getInvitePreview(supabase, token);
  if (!preview) return { sent: false, email: "", nonce: Date.now(), error: NOT_VALID };
  try {
    await supabase.auth.signInWithOtp({
      email: preview.email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${await siteUrl()}/auth/callback?next=${encodeURIComponent(`/invite/${token}`)}`,
      },
    });
  } catch {
    // same answer on any failure
  }
  return { sent: true, email: preview.email, nonce: Date.now() };
}
