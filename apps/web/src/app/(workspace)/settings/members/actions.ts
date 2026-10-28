"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/session";
import { generateInviteToken, hashInviteToken } from "@/lib/auth/invite-token";
import { parseRole } from "@/lib/roles";
import { parseInviteForm } from "@/lib/validation";
import { githubUsernameMessage } from "@/lib/github-username";
import { siteUrl } from "@/lib/site-url";
import { emailConfigured, sendEmail } from "@/lib/email/resend";
import { buildInvitationEmail, sendLimit } from "@/lib/email/invitation";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildAccessApprovedEmail } from "@/lib/email/access";
import { statusAfterSignup, type MemberStatus } from "@pv/domain";

export type InviteState = { error?: string; link?: string; email?: string; emailed?: boolean; emailNote?: string } | null;
export type SaveResult = { ok: true } | { ok: false; error: string };

const PATH = "/settings/members";

/**
 * Emails an invitation (only after the admin confirmed in the preview) and records what happened on the invitation row.
 * Returns a short note for the admin; the recipient address is never logged.
 */
async function emailInvitation(opts: { invitationId: string; tenantId: string; tenantName: string; inviter: string; email: string; role: Parameters<typeof buildInvitationEmail>[0]["role"]; isApprover: boolean; link: string }): Promise<{ emailed: boolean; note: string }> {
  const admin = createAdminClient({ via: "UI" });
  const { data: row } = await admin.from("invitations").select("email_send_count, email_sent_at").eq("id", opts.invitationId).single();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await admin.from("invitations").select("id", { count: "exact", head: true }).eq("tenant_id", opts.tenantId).gte("email_sent_at", since);
  const limited = sendLimit({ sendCount: row?.email_send_count ?? 0, lastSentAt: row?.email_sent_at ?? null, workspaceLastDay: count ?? 0 });
  if (limited) return { emailed: false, note: limited };
  const mail = buildInvitationEmail({ workspace: opts.tenantName, inviter: opts.inviter, role: opts.role, isApprover: opts.isApprover, link: opts.link });
  const sent = await sendEmail({ to: opts.email, ...mail });
  await admin.from("invitations").update(
    sent.ok
      ? { email_status: "sent", email_sent_at: new Date().toISOString(), email_send_count: (row?.email_send_count ?? 0) + 1, email_error: null, email_provider_id: sent.id }
      : { email_status: "failed", email_error: sent.error.slice(0, 200) },
  ).eq("id", opts.invitationId);
  return sent.ok ? { emailed: true, note: "Emailed." } : { emailed: false, note: sent.error };
}

const inviterName = (user: { email?: string | null; user_metadata?: Record<string, unknown> }) =>
  (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name) || user.email || "A colleague";

/** Creates the invitation. With delivery "email" it also sends the email, because the admin confirmed it in the preview; the one-time link is always returned. */
export async function createInvitation(_prev: InviteState, form: FormData): Promise<InviteState> {
  const { supabase, active, user } = await requireWorkspace(PATH);
  if (active.role !== "admin") return { error: "Only admins can invite people." };
  const input = parseInviteForm(form);
  if ("error" in input) return { error: input.error };

  const { data: people } = await supabase.rpc("tenant_directory", { p_tenant: active.tenantId });
  if ((people ?? []).some((p: { email: string }) => p.email?.toLowerCase() === input.email)) {
    return { error: "That person is already a member." };
  }

  const token = generateInviteToken();
  const { data: created, error } = await supabase.from("invitations").insert({
    tenant_id: active.tenantId,
    email: input.email,
    role: input.role,
    is_approver: input.isApprover,
    token_hash: hashInviteToken(token),
  }).select("id").single();
  if (error) {
    if (error.code === "23505") {
      return { error: "There is already a pending invitation for that email. Revoke it first to create a new link." };
    }
    if (error.code === "PV012") return { error: "This workspace only invites people at its authorized domains. Change that under Workspace settings, or invite an address on one of them." };
    if (error.code === "PV022") return { error: "Platform admins cannot invite people into a customer account." };
    return { error: "We could not create the invitation." };
  }
  const link = `${await siteUrl()}/invite/${token}`;
  let result: { emailed: boolean; note: string } | null = null;
  if (form.get("delivery") === "email" && created) {
    result = await emailInvitation({ invitationId: created.id, tenantId: active.tenantId, tenantName: active.tenantName, inviter: inviterName(user), email: input.email, role: input.role, isApprover: input.isApprover, link });
  }
  revalidatePath(PATH);
  return { link, email: input.email, ...(result ? { emailed: result.emailed, emailNote: result.note } : {}) };
}

/** "Resend": a new link (the old one stops working) and, if the admin asked for it, a new email. */
export async function resendInvitation(_prev: InviteState, form: FormData): Promise<InviteState> {
  const { supabase, active, user } = await requireWorkspace(PATH);
  const id = form.get("id");
  if (active.role !== "admin" || typeof id !== "string") return { error: "Only admins can resend invitations." };
  const { data: inv } = await supabase.from("invitations").select("id, email, role, is_approver").eq("id", id).eq("tenant_id", active.tenantId).is("accepted_at", null).is("revoked_at", null).maybeSingle();
  if (!inv) return { error: "That invitation is no longer pending." };
  const token = generateInviteToken();
  const { error } = await supabase.rpc("invitation_reissue", { p_id: inv.id, p_token_hash: hashInviteToken(token) });
  if (error) return { error: "We could not renew the invitation." };
  const link = `${await siteUrl()}/invite/${token}`;
  let result: { emailed: boolean; note: string } | null = null;
  if (form.get("delivery") === "email") {
    result = await emailInvitation({ invitationId: inv.id, tenantId: active.tenantId, tenantName: active.tenantName, inviter: inviterName(user), email: inv.email, role: inv.role, isApprover: inv.is_approver, link });
  }
  revalidatePath(PATH);
  return { link, email: inv.email, ...(result ? { emailed: result.emailed, emailNote: result.note } : {}) };
}

/** An admin sets (or clears) the GitHub username of a member; the database checks the role again and that the name is free in this workspace. */
export async function setMemberGithubUsername(userId: string, username: string): Promise<SaveResult> {
  const { supabase, active } = await requireWorkspace(PATH);
  if (active.role !== "admin") return { ok: false, error: "Only an admin can set someone else's GitHub username." };
  const { error } = await supabase.rpc("set_github_username", { p_tenant: active.tenantId, p_user: userId, p_username: username });
  if (error) return { ok: false, error: githubUsernameMessage(error.code) };
  revalidatePath(PATH);
  return { ok: true };
}

export async function updateMember(memberId: string, role: string, isApprover: boolean): Promise<SaveResult> {
  const { supabase, active } = await requireWorkspace(PATH);
  const parsed = parseRole(role);
  if (active.role !== "admin" || !parsed) return { ok: false, error: "Not allowed." };
  const { data, error } = await supabase
    .from("tenant_members")
    .update({ role: parsed, is_approver: isApprover })
    .eq("id", memberId)
    .eq("tenant_id", active.tenantId)
    .select("id");
  if (error?.code === "PV003") return { ok: false, error: "A workspace must keep at least one admin." };
  if (error || !data?.length) return { ok: false, error: "Could not save." };
  revalidatePath(PATH);
  return { ok: true };
}

export type StatusResult = { key: string; email: string | null; ok: boolean; reason?: string; emailed?: boolean };
export type StatusOutcome = { ok: true; results: StatusResult[] } | { ok: false; error: string };

/**
 * Batch status change from the members grid. `memberIds` are workspace members (active, paused, revoked, requested); `invitationIds` are
 * pending invitations, which can only be cancelled (Revoked). Each row is reported separately. Becoming active from Requested Access
 * emails the person a confirmation with the link back (FR-4.3); a failed email never undoes the approval.
 */
export async function changeMemberStatus(memberIds: string[], invitationIds: string[], status: string): Promise<StatusOutcome> {
  const { supabase, active } = await requireWorkspace(PATH);
  if (active.role !== "admin") return { ok: false, error: "Only admins can change a member's status." };
  if (status !== "active" && status !== "paused" && status !== "revoked") return { ok: false, error: "Choose a status." };
  if (memberIds.length + invitationIds.length === 0) return { ok: false, error: "Select at least one row." };
  if (memberIds.length + invitationIds.length > 500) return { ok: false, error: "Select at most 500 rows at a time." };
  const results: StatusResult[] = [];

  if (memberIds.length > 0) {
    const { data, error } = await supabase.rpc("set_member_status", { p_ids: memberIds, p_status: status });
    if (error) return { ok: false, error: "We could not change the status." };
    const rows = (data ?? []) as { member_id: string; email: string | null; previous_status: string | null; ok: boolean; reason: string | null }[];
    const mail = emailConfigured() ? await approvalMailer(active.tenantName) : null;
    for (const r of rows) {
      const out: StatusResult = { key: r.member_id, email: r.email, ok: r.ok, ...(r.reason ? { reason: r.reason } : {}) };
      if (r.ok && r.email && r.previous_status && statusAfterSignup(r.previous_status as MemberStatus, "active") && status === "active") {
        out.emailed = mail ? await mail(r.email) : false;
      }
      results.push(out);
    }
  }

  if (invitationIds.length > 0) {
    if (status !== "revoked") {
      for (const id of invitationIds) results.push({ key: id, email: null, ok: false, reason: "An invitation can only be cancelled. The person becomes Active when they accept it." });
    } else {
      const { data } = await supabase
        .from("invitations")
        .update({ revoked_at: new Date().toISOString() })
        .in("id", invitationIds)
        .eq("tenant_id", active.tenantId)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .select("id, email");
      const done = new Map((data ?? []).map((i) => [i.id as string, i.email as string]));
      for (const id of invitationIds) results.push(done.has(id) ? { key: id, email: done.get(id)!, ok: true } : { key: id, email: null, ok: false, reason: "That invitation is no longer pending." });
    }
  }
  revalidatePath(PATH);
  return { ok: true, results };
}

async function approvalMailer(workspace: string): Promise<(to: string) => Promise<boolean>> {
  const link = `${await siteUrl()}/`;
  const mail = buildAccessApprovedEmail({ workspace, link });
  return async (to) => (await sendEmail({ to, ...mail })).ok;
}
