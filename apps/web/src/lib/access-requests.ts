import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailConfigured, sendEmail } from "@/lib/email/resend";
import { buildAccessRequestEmail } from "@/lib/email/access";
import { siteUrl } from "@/lib/site-url";

export type PendingAccess = { tenantId: string; tenantName: string };

/**
 * Domain-gated sign-up (FR-2.1): a signed-in person with a confirmed email at an authorized domain gets a Requested Access row,
 * which grants nothing. New requests email the workspace's admins (FR-2.2; the in-app alert is the count on the members page and banner).
 * Returns every workspace this person is waiting on. Email failures never block the person; recipient addresses are never logged.
 */
export async function syncDomainAccess(supabase: SupabaseClient, requesterEmail: string): Promise<PendingAccess[]> {
  const { data, error } = await supabase.rpc("request_access_by_domain");
  if (error || !Array.isArray(data)) return [];
  const rows = data as { tenant_id: string; tenant_name: string; created: boolean }[];
  const fresh = rows.filter((r) => r.created);
  if (fresh.length > 0 && emailConfigured()) {
    const admin = createAdminClient({ via: "system" });
    const link = `${await siteUrl()}/settings/members`;
    for (const r of fresh) {
      const { data: emails } = await admin.rpc("tenant_admin_emails", { p_tenant: r.tenant_id });
      const mail = buildAccessRequestEmail({ workspace: r.tenant_name, requester: requesterEmail, link });
      for (const to of ((emails ?? []) as string[]).slice(0, 10)) await sendEmail({ to, ...mail });
    }
  }
  return rows.map((r) => ({ tenantId: r.tenant_id, tenantName: r.tenant_name }));
}

export type AccessState = { tenantId: string; tenantName: string; status: "requested" | "paused" | "revoked"; since: string };

export async function myAccessStates(supabase: SupabaseClient): Promise<AccessState[]> {
  const { data } = await supabase.rpc("my_access_requests");
  return ((data ?? []) as { tenant_id: string; tenant_name: string; status: AccessState["status"]; since: string }[]).map((r) => ({
    tenantId: r.tenant_id, tenantName: r.tenant_name, status: r.status, since: r.since,
  }));
}
