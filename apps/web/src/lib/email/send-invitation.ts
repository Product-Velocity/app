import "server-only";
import { siteUrl } from "@/lib/site-url";
import { sendLogged } from "@/lib/email/send";
import { loadEmailOverride } from "@/lib/email/override";
import { buildInvitationEmail, sendLimit } from "@/lib/email/invitation";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Emails an invitation (only after a person confirmed it) and records what happened on the invitation row.
 * Shared by the workspace Members page and the platform All accounts console. Returns a short note; the recipient address is never logged.
 */
export async function emailInvitation(opts: { invitationId: string; tenantId: string; tenantName: string; inviter: string; email: string; role: Parameters<typeof buildInvitationEmail>[0]["role"]; isApprover: boolean; link: string; /** The invitee's first name when someone typed it for them (never guessed from the address). */ firstname?: string }): Promise<{ emailed: boolean; note: string }> {
  const admin = createAdminClient({ via: "UI" });
  const { data: row } = await admin.from("invitations").select("email_send_count, email_sent_at").eq("id", opts.invitationId).single();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await admin.from("invitations").select("id", { count: "exact", head: true }).eq("tenant_id", opts.tenantId).gte("email_sent_at", since);
  const limited = sendLimit({ sendCount: row?.email_send_count ?? 0, lastSentAt: row?.email_sent_at ?? null, workspaceLastDay: count ?? 0 });
  if (limited) return { emailed: false, note: limited };
  const mail = buildInvitationEmail({ ...(opts.firstname ? { firstname: opts.firstname } : {}), workspace: opts.tenantName, inviter: opts.inviter, role: opts.role, isApprover: opts.isApprover, link: opts.link, siteUrl: await siteUrl(), override: await loadEmailOverride("app.invitation") });
  const sent = await sendLogged("app.invitation", { to: opts.email, ...mail }, { tenantId: opts.tenantId });
  await admin.from("invitations").update(
    sent.ok
      ? { email_status: "sent", email_sent_at: new Date().toISOString(), email_send_count: (row?.email_send_count ?? 0) + 1, email_error: null, email_provider_id: sent.id }
      : { email_status: "failed", email_error: sent.error.slice(0, 200) },
  ).eq("id", opts.invitationId);
  return sent.ok ? { emailed: true, note: "Emailed." } : { emailed: false, note: sent.error };
}
