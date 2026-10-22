import type { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/roles";

export type InvitePreview = {
  tenantName: string;
  email: string;
  role: Role;
  isApprover: boolean;
  /** The invited email already has an account (so the page opens in sign-in mode). */
  accountExists: boolean;
};

/** Details of a pending invitation for whoever holds the link, or null if it is not usable. */
export async function getInvitePreview(
  supabase: Awaited<ReturnType<typeof createClient>>,
  token: string,
): Promise<InvitePreview | null> {
  if (token.length < 20 || token.length > 200) return null;
  const [preview, account] = await Promise.all([
    supabase.rpc("invitation_preview", { p_token: token }),
    supabase.rpc("invitation_account_exists", { p_token: token }),
  ]);
  const row = (preview.data as { tenant_name: string; email: string; role: Role; is_approver: boolean }[] | null)?.[0];
  return row
    ? {
        tenantName: row.tenant_name,
        email: row.email,
        role: row.role,
        isApprover: row.is_approver,
        accountExists: account.data === true,
      }
    : null;
}
