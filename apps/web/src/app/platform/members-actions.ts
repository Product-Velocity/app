"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/session";
import { generateInviteToken, hashInviteToken } from "@/lib/auth/invite-token";
import { parseRole } from "@/lib/roles";
import { siteUrl } from "@/lib/site-url";
import { emailConfigured } from "@/lib/email/resend";
import { emailInvitation } from "@/lib/email/send-invitation";
import { memberErrorText, type MemberRow } from "./accounts-model";

// The narrow exception to "platform admins never change members" (Ashu, 2026-11-22, docs/decisions/2026-11-22-platform-accounts-console.md):
// invite, renew or cancel an invitation, and pause / resume / revoke a person. Never roles, never Approver, never a service account.
// The database does the checks again (recent sign-in, not read-only, the last admin) and logs each action in the account's audit log.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type MembersResult = { ok: true; rows: MemberRow[] } | { ok: false; error: string };
export type InviteResult = { ok: true; link: string; email: string; emailed: boolean; note: string | null } | { ok: false; error: string };
export type PlainResult = { ok: true } | { ok: false; error: string };

export async function loadAccountMembers(tenant: string): Promise<MembersResult> {
  const { supabase } = await requirePlatformAdmin("/platform");
  if (!UUID.test(tenant)) return { ok: false, error: "That account does not exist." };
  const { data, error } = await supabase.rpc("platform_account_members", { p_tenant: tenant });
  if (error) return { ok: false, error: memberErrorText(error.code) };
  return { ok: true, rows: (data ?? []) as MemberRow[] };
}

const inviterLabel = (u: { email?: string | null; user_metadata?: Record<string, unknown> }) =>
  `${(typeof u.user_metadata?.full_name === "string" && u.user_metadata.full_name) || "Product Velocity"} (Product Velocity)`;

/** Creates the invitation; with delivery "email" it also sends it (the person confirmed in the drawer). The one-time link is always returned. */
export async function inviteMember(tenant: string, email: string, role: string, delivery: "email" | "link"): Promise<InviteResult> {
  const { supabase, user } = await requirePlatformAdmin("/platform");
  const to = email.trim().toLowerCase();
  const r = parseRole(role);
  if (!UUID.test(tenant) || !r || to.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { ok: false, error: "Enter a valid email address and choose a role." };
  const token = generateInviteToken();
  const { data, error } = await supabase.rpc("platform_invite_member", { p_tenant: tenant, p_email: to, p_role: r, p_token_hash: hashInviteToken(token) });
  const made = (Array.isArray(data) ? data[0] : data) as { invitation_id: string; tenant_name: string } | undefined;
  if (error || !made) return { ok: false, error: memberErrorText(error?.code) };
  const link = `${await siteUrl()}/invite/${token}`;
  let emailed = false, note: string | null = null;
  if (delivery === "email") {
    if (!emailConfigured()) note = "Email is not set up on this deployment, so the link has to be sent by you.";
    else {
      const sent = await emailInvitation({ invitationId: made.invitation_id, tenantId: tenant, tenantName: made.tenant_name, inviter: inviterLabel(user), email: to, role: r, isApprover: false, link });
      emailed = sent.emailed; note = sent.emailed ? null : sent.note;
    }
  }
  revalidatePath("/platform");
  return { ok: true, link, email: to, emailed, note };
}

/** A new link for a pending invitation (the old one stops working), emailed or not. */
export async function renewInvitation(invitationId: string, tenant: string, delivery: "email" | "link"): Promise<InviteResult> {
  const { supabase, user } = await requirePlatformAdmin("/platform");
  if (!UUID.test(invitationId) || !UUID.test(tenant)) return { ok: false, error: "That invitation no longer exists." };
  const token = generateInviteToken();
  const { data, error } = await supabase.rpc("platform_reissue_invitation", { p_id: invitationId, p_token_hash: hashInviteToken(token) });
  const row = (Array.isArray(data) ? data[0] : data) as { email: string; role: string; tenant_id: string; tenant_name: string } | undefined;
  if (error || !row) return { ok: false, error: memberErrorText(error?.code) };
  const link = `${await siteUrl()}/invite/${token}`;
  let emailed = false, note: string | null = null;
  const role = parseRole(row.role);
  if (delivery === "email" && role) {
    if (!emailConfigured()) note = "Email is not set up on this deployment, so the link has to be sent by you.";
    else {
      const sent = await emailInvitation({ invitationId, tenantId: row.tenant_id, tenantName: row.tenant_name, inviter: inviterLabel(user), email: row.email, role, isApprover: false, link });
      emailed = sent.emailed; note = sent.emailed ? null : sent.note;
    }
  }
  revalidatePath("/platform");
  return { ok: true, link, email: row.email, emailed, note };
}

export async function cancelInvitation(invitationId: string): Promise<PlainResult> {
  const { supabase } = await requirePlatformAdmin("/platform");
  if (!UUID.test(invitationId)) return { ok: false, error: "That invitation no longer exists." };
  const { error } = await supabase.rpc("platform_cancel_invitation", { p_id: invitationId });
  if (error) return { ok: false, error: memberErrorText(error.code) };
  revalidatePath("/platform");
  return { ok: true };
}

export async function changePersonStatus(memberId: string, status: "active" | "paused" | "revoked"): Promise<PlainResult> {
  const { supabase } = await requirePlatformAdmin("/platform");
  if (!UUID.test(memberId) || !["active", "paused", "revoked"].includes(status)) return { ok: false, error: "That person no longer exists." };
  const { error } = await supabase.rpc("platform_set_member_status", { p_member: memberId, p_status: status });
  if (error) return { ok: false, error: memberErrorText(error.code) };
  revalidatePath("/platform");
  return { ok: true };
}
