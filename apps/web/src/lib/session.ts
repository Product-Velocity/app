import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/roles";

import { TENANT_COOKIE, URL_TENANT_HEADER } from "@/lib/session-keys";

export { TENANT_COOKIE, URL_TENANT_HEADER };

export type Membership = {
  tenantId: string;
  tenantName: string;
  role: Role;
  isApprover: boolean;
  lastLoginAt: string | null;
};

/** A platform admin working inside a customer account (docs/15 section 5b). Not a membership: the person is hidden from the members grid. */
export type PlatformAccess = {
  level: "read_write" | "read_only";
  adminName: string;
  adminEmail: string;
  expiresAt: string;
};

export type ActiveWorkspace = Membership & {
  platform: PlatformAccess | null;
};

const signInUrl = (next: string) => `/sign-in?next=${encodeURIComponent(next)}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** Which account the person is looking at: the address wins over the remembered choice. */
export async function requestedTenant(): Promise<{ id: string | null; fromUrl: boolean }> {
  const fromHeader = (await headers()).get(URL_TENANT_HEADER);
  if (fromHeader && UUID.test(fromHeader)) return { id: fromHeader.toLowerCase(), fromUrl: true };
  const fromCookie = (await cookies()).get(TENANT_COOKIE)?.value;
  return { id: fromCookie && UUID.test(fromCookie) ? fromCookie.toLowerCase() : null, fromUrl: false };
}

/**
 * requireUser plus a tenant: sends people without one to onboarding.
 * An account in the address that the person cannot open is "not found" for everybody (FR-5.3): no names, no counts.
 * A platform admin reaches a customer account only through an open entry (migration 0051); without one they see their own accounts.
 */
export async function requireWorkspace(nextPath: string) {
  const { supabase, user } = await requireUser(nextPath);
  const memberships = await loadMemberships(supabase, user.id);
  const wanted = await requestedTenant();

  let active: ActiveWorkspace | undefined;
  const member = memberships.find((m) => m.tenantId === wanted.id);
  if (member) {
    active = { ...member, platform: null };
  } else if (memberships.length === 0 || wanted.id) {
    const entry = await currentPlatformEntry(supabase);
    if (entry && (!wanted.id || entry.tenantId === wanted.id)) {
      // read-only entries are treated as a viewer everywhere in the UI; the database refuses the writes in any case
      active = {
        tenantId: entry.tenantId, tenantName: entry.tenantName, role: entry.level === "read_write" ? "admin" : "viewer", isApprover: false, lastLoginAt: null,
        platform: { level: entry.level, adminName: entry.adminName, adminEmail: entry.adminEmail, expiresAt: entry.expiresAt },
      };
    }
  }
  if (!active) {
    if (wanted.fromUrl) notFound();
    if (memberships.length === 0) {
      redirect((await isPlatformAdmin(supabase)) ? "/platform" : "/onboarding");
    }
    // no usable address or cookie: the account used most recently (FR-1.4), else the oldest membership
    const recent = [...memberships].sort((a, b) => (b.lastLoginAt ?? "").localeCompare(a.lastLoginAt ?? ""))[0]!;
    active = { ...recent, platform: null };
  }
  return { supabase, user, memberships, active };
}

export async function loadMemberships(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<Membership[]> {
  const { data, error } = await supabase
    .from("tenant_members")
    .select("tenant_id, role, is_approver, last_login_at, tenants(name)")
    .eq("user_id", userId)
    .eq("status", "active") // requested, paused and revoked people have no workspace (docs/15 section 3b)
    .order("created_at");
  if (error) throw new Error(`Could not load memberships: ${error.message}`);
  return (data ?? []).map((row) => {
    const t = row.tenants as unknown as { name: string } | { name: string }[] | null;
    return {
      tenantId: row.tenant_id as string,
      tenantName: (Array.isArray(t) ? t[0]?.name : t?.name) ?? "Workspace",
      role: row.role as Role,
      isApprover: row.is_approver as boolean,
      lastLoginAt: (row.last_login_at as string | null) ?? null,
    };
  });
}

type Db = Awaited<ReturnType<typeof createClient>>;

export async function isPlatformAdmin(supabase: Db): Promise<boolean> {
  const { data } = await supabase.rpc("platform_is_admin");
  return data === true;
}

/** The platform admin's open entry into a customer account, if any. */
export async function currentPlatformEntry(supabase: Db) {
  const { data } = await supabase.rpc("platform_current_entry");
  const row = (Array.isArray(data) ? data[0] : data) as
    | { tenant_id: string; tenant_name: string; access_level: "read_write" | "read_only"; expires_at: string; admin_name: string; admin_email: string }
    | undefined;
  return row
    ? { tenantId: row.tenant_id, tenantName: row.tenant_name, level: row.access_level, expiresAt: row.expires_at, adminName: row.admin_name, adminEmail: row.admin_email }
    : null;
}

/** Platform admins only: the console and its actions. Everybody else gets "not found", so the console's existence is not confirmed. */
export async function requirePlatformAdmin(nextPath: string) {
  const { supabase, user } = await requireUser(nextPath);
  if (!(await isPlatformAdmin(supabase))) notFound();
  return { supabase, user };
}

/**
 * Actions that send something outward, approve, or read secrets are not available to a platform admin acting in a customer account
 * (CLAUDE.md rule 10, docs/15 section 5.5). The database already refuses member changes and the Approver flag.
 */
/** Last login is recorded at most once a minute per account (the database also enforces it). */
export function loginIsStale(lastLoginAt: string | null): boolean {
  return !lastLoginAt || Date.now() - Date.parse(lastLoginAt) > 60_000;
}

export function platformRefusal(active: { platform: PlatformAccess | null }): string | null {
  return active.platform ? "Platform admins cannot do this inside a customer account." : null;
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
