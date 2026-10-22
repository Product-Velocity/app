"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { rememberTenant } from "@/lib/session";

export type AcceptState = { error?: string } | null;

export async function acceptInvitation(_prev: AcceptState, form: FormData): Promise<AcceptState> {
  const token = form.get("token");
  if (typeof token !== "string" || token.length < 20 || token.length > 200) {
    return { error: "This invitation link is not valid." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error) {
    if (error.code === "PV002") return { error: "You are already a member of this workspace." };
    return {
      error:
        "This invitation is not valid for the account you are signed in with. It may have expired, been used or revoked, or it was sent to a different email address.",
    };
  }
  await rememberTenant(data as string);
  redirect("/home");
}
