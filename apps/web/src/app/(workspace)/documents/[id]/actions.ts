"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canEditItems } from "@pv/domain";
import { requireWorkspace } from "@/lib/session";

export type DocState = { error?: string; saved?: string } | null;
const UUID = /^[0-9a-f-]{36}$/i;

/** A person accepts an AI draft as their own, or moves a document between draft and in review. Approval is not offered here (an Approver does it in the database's own flow). */
export async function updateWorkspaceDocument(_prev: DocState, form: FormData): Promise<DocState> {
  const id = String(form.get("id") ?? "");
  if (!UUID.test(id)) return { error: "That document does not exist." };
  const { supabase, active } = await requireWorkspace(`/documents/${id}`);
  if (!canEditItems(active.role)) return { error: "Your role in this workspace is read-only." };
  const action = String(form.get("action") ?? "");
  const patch: Record<string, unknown> =
    action === "accept" ? { ai_draft: false } : action === "draft" ? { status: "draft" } : action === "review" ? { status: "in_review" } : {};
  if (Object.keys(patch).length === 0) return { error: "Nothing to change." };
  const { data, error } = await supabase.from("workspace_documents").update(patch).eq("tenant_id", active.tenantId).eq("id", id).select("id");
  if (error) return { error: "We could not save the change." };
  if (!data?.length) return { error: "That document no longer exists." };
  revalidatePath(`/documents/${id}`);
  revalidatePath("/documents");
  return { saved: "Saved." };
}

export async function deleteWorkspaceDocument(form: FormData): Promise<void> {
  const id = String(form.get("id") ?? "");
  if (!UUID.test(id) || form.get("confirm") !== "yes") redirect("/documents");
  const { supabase, active } = await requireWorkspace(`/documents/${id}`);
  if (canEditItems(active.role)) await supabase.from("workspace_documents").delete().eq("tenant_id", active.tenantId).eq("id", id);
  revalidatePath("/documents");
  redirect("/documents");
}
