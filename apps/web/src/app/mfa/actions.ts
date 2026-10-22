"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/safe-next";

export type MfaState = { error?: string } | null;

/** Second step of sign-in for people who enabled an authenticator app. */
export async function verifyMfa(_prev: MfaState, form: FormData): Promise<MfaState> {
  const code = String(form.get("code") ?? "").replace(/\s+/g, "");
  const next = safeNext(form.get("next") as string | null, "/");
  if (!/^\d{6}$/.test(code)) return { error: "Enter the 6-digit code from your authenticator app." };

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect("/sign-in");
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp[0];
  if (!factor) redirect(next);

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return { error: "That code is not correct. Try the newest code." };
  redirect(next);
}
