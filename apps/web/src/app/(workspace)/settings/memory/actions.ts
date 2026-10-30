"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/session";

const PATH = "/settings/memory";
const back = (status: string, extra = ""): never => redirect(`${PATH}?status=${status}${extra}`);
const uuid = (v: FormDataEntryValue | null) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

/** What a person can do to a note. RLS lets editors confirm, archive and restore, and admins delete for good; the database refuses an AI assistant any of the person-only steps. */
export async function changeNote(formData: FormData) {
  const { supabase, active } = await requireWorkspace(PATH);
  const id = uuid(formData.get("id"));
  const action = String(formData.get("action") ?? "");
  if (!id) return back("failed");
  if (active.role === "viewer" || active.role === "commenter" || active.role === "leadership") return back("not-editor");
  if (action === "delete") {
    if (active.role !== "admin") return back("not-admin");
    const { data, error } = await supabase.from("ai_memories").delete().eq("tenant_id", active.tenantId).eq("id", id).select("id");
    if (error || !data?.length) return back("failed");
    revalidatePath(PATH);
    return back("deleted");
  }
  const status = action === "confirm" ? "confirmed" : action === "archive" ? "archived" : action === "restore" ? "draft" : null;
  if (!status) return back("failed");
  const { data, error } = await supabase.from("ai_memories").update({ status }).eq("tenant_id", active.tenantId).eq("id", id).select("id");
  if (error) return back(error.code === "23505" ? "duplicate" : "failed");
  if (!data?.length) return back("failed");
  revalidatePath(PATH);
  return back(action === "confirm" ? "confirmed" : action === "archive" ? "archived" : "restored");
}

/** Edits the text of a note as a person (it then counts as reviewed, and stays confirmed if it was). */
export async function editNote(formData: FormData) {
  const { supabase, active } = await requireWorkspace(PATH);
  const id = uuid(formData.get("id"));
  if (!id) return back("failed");
  if (active.role === "viewer" || active.role === "commenter" || active.role === "leadership") return back("not-editor");
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const source = String(formData.get("source") ?? "").trim();
  if (!title || !body || !source || title.length > 120 || body.length > 2000 || source.length > 300) return back("invalid");
  const { data, error } = await supabase.from("ai_memories").update({ title, body, source }).eq("tenant_id", active.tenantId).eq("id", id).select("id");
  if (error) return back(error.code === "23505" ? "duplicate" : "failed");
  if (!data?.length) return back("failed");
  revalidatePath(PATH);
  return back("saved");
}
