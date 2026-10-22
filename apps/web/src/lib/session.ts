import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/roles";

export const TENANT_COOKIE = "pv_tenant";

export type Membership = {
  tenantId: string;
  tenantName: string;
  role: Role;
  isApprover: boolean;
};

const signInUrl = (next: string) => `/sign-in?next=${encodeURIComponent(next)}`;

/** Signed-in user (validated with Supabase) who has completed 2FA if they enrolled. */
export async function requireUser(nextPath: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect(signInUrl(nextPath));

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    redirect(`/mfa?next=${encodeURIComponent(nextPath)}`);
  }
  return { supabase, user: data.user };
}

/** requireUser plus a tenant: sends people without one to onboarding. */
export async function requireWorkspace(nextPath: string) {
  const { supabase, user } = await requireUser(nextPath);
  const memberships = await loadMemberships(supabase, user.id);
  if (memberships.length === 0) redirect("/onboarding");

  const wanted = (await cookies()).get(TENANT_COOKIE)?.value;
  const active = memberships.find((m) => m.tenantId === wanted) ?? memberships[0]!;
  return { supabase, user, memberships, active };
}

export async function loadMemberships(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<Membership[]> {
  const { data, error } = await supabase
    .from("tenant_members")
    .select("tenant_id, role, is_approver, tenants(name)")
    .eq("user_id", userId)
    .order("created_at");
  if (error) throw new Error(`Could not load memberships: ${error.message}`);
  return (data ?? []).map((row) => {
    const t = row.tenants as unknown as { name: string } | { name: string }[] | null;
    return {
      tenantId: row.tenant_id as string,
      tenantName: (Array.isArray(t) ? t[0]?.name : t?.name) ?? "Workspace",
      role: row.role as Role,
      isApprover: row.is_approver as boolean,
    };
  });
}

export async function rememberTenant(tenantId: string) {
  (await cookies()).set(TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
