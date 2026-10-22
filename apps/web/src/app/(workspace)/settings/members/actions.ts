"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/session";
import { generateInviteToken, hashInviteToken } from "@/lib/auth/invite-token";
import { parseRole } from "@/lib/roles";
import { parseInviteForm } from "@/lib/validation";
import { siteUrl } from "@/lib/site-url";

export type InviteState = { error?: string; link?: string; email?: string } | null;
export type SaveResult = { ok: true } | { ok: false; error: string };

const PATH = "/settings/members";

/** Creates the invitation and returns the one-time link. Nothing is emailed. */
export async function createInvitation(_prev: InviteState, form: FormData): Promise<InviteState> {
  const { supabase, active } = await requireWorkspace(PATH);
  if (active.role !== "admin") return { error: "Only admins can invite people." };
  const input = parseInviteForm(form);
  if ("error" in input) return { error: input.error };

  const { data: people } = await supabase.rpc("tenant_directory", { p_tenant: active.tenantId });
  if ((people ?? []).some((p: { email: string }) => p.email?.toLowerCase() === input.email)) {
    return { error: "That person is already a member." };
  }

  const token = generateInviteToken();
  const { error } = await supabase.from("invitations").insert({
    tenant_id: active.tenantId,
    email: input.email,
    role: input.role,
    is_approver: input.isApprover,
    token_hash: hashInviteToken(token),
  });
  if (error) {
    if (error.code === "23505") {
      return { error: "There is already a pending invitation for that email. Revoke it first to create a new link." };
    }
    return { error: "We could not create the invitation." };
  }
  revalidatePath(PATH);
  return { link: `${await siteUrl()}/invite/${token}`, email: input.email };
}

export async function revokeInvitation(form: FormData): Promise<void> {
  const { supabase, active } = await requireWorkspace(PATH);
  const id = form.get("id");
  if (active.role !== "admin" || typeof id !== "string") return;
  await supabase
    .from("invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", active.tenantId);
  revalidatePath(PATH);
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

export async function removeMember(form: FormData): Promise<void> {
  const { supabase, active } = await requireWorkspace(PATH);
  const id = form.get("id");
  if (active.role !== "admin" || typeof id !== "string") return;
  await supabase.from("tenant_members").delete().eq("id", id).eq("tenant_id", active.tenantId);
  revalidatePath(PATH);
}
