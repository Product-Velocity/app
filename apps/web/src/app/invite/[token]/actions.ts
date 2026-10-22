"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { rememberTenant } from "@/lib/session";
import { siteUrl } from "@/lib/site-url";
import { MIN_PASSWORD_LENGTH } from "@/lib/validation";
import { getInvitePreview } from "./preview";

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
  redirect("/home");
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
      error:
        "The password is incorrect, or this email has no password yet. If you have not created an account, use Create account. You can also continue with Google or GitHub.",
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
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  const supabase = await createClient();
  const preview = await getInvitePreview(supabase, token);
  if (!preview) return { error: NOT_VALID };

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
