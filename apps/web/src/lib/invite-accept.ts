import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const INVITE_NOT_VALID =
  "This invitation is not valid. It may have expired, been used or revoked, or it was sent to a different email address.";

export type AcceptResult = { ok: true; tenantId: string } | { ok: false; error: string };

/** Accept an invitation as the signed-in person. The database checks the token and that the signed-in email is the invited one. */
export async function acceptInviteToken(supabase: Supabase, token: string): Promise<AcceptResult> {
  const { data, error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error) {
    if (error.code === "PV002") return { ok: false, error: "You are already a member of this workspace." };
    return { ok: false, error: INVITE_NOT_VALID };
  }
  return { ok: true, tenantId: data as string };
}

/** The invitation token in a same-site `next` path like `/invite/<token>`, or null. */
export function inviteTokenFromNext(next: string): string | null {
  const m = /^\/invite\/([A-Za-z0-9_-]{20,200})\/?$/.exec(next);
  return m?.[1] ?? null;
}
