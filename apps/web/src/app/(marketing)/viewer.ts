import { createClient } from "@/lib/supabase/server";
import { isDemoEmail } from "@/lib/demo-account";

/** How the visitor is signed in, for the public pages: not at all, as a member of a workspace, or in the shared demo account. */
export async function getViewer(): Promise<"member" | "demo" | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ? (isDemoEmail(data.user.email) ? "demo" : "member") : null;
}
