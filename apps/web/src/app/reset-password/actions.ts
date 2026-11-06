"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { checkPassword } from "@/lib/password";

export type ResetState = { error?: string } | null;

/** Sets the new password for the person who opened the emailed link, then signs out every other device. */
export async function setNewPassword(_prev: ResetState, form: FormData): Promise<ResetState> {
  const { supabase, user } = await requireUser("/reset-password"); // also sends people with 2FA to the code step first
  const password = form.get("password");
  if (typeof password !== "string" || !checkPassword(password, { email: user.email ?? undefined }).ok) {
    return { error: "Choose a stronger password: follow the checklist under the password field." };
  }
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return {
      error:
        error.code === "same_password"
          ? "Choose a password you have not used before."
          : "We could not change your password. Request a new link and try again.",
    };
  }
  // anyone who held an older session (for example someone who guessed the old password) is signed out
  await supabase.auth.signOut({ scope: "others" });
  redirect("/");
}
