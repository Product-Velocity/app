import { createAdminClient } from "@/lib/supabase/admin";

/** R-111 FR-4.2: a verified linked address opens the same person. Anything unknown stays as typed, so the answer never differs. */
export async function resolveSignInEmail(email: string): Promise<string> {
  try {
    const { data } = await createAdminClient({ via: "system" }).rpc("resolve_sign_in_email", { p_email: email });
    return typeof data === "string" && data ? data : email;
  } catch {
    return email; // no service key (local development): a linked address simply does not resolve
  }
}
