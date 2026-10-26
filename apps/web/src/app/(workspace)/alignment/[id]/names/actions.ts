"use server";

import { requireWorkspace } from "@/lib/session";

export type NamesState = { error?: string; rows?: { name: string | null; email: string | null; group: string; voted: boolean; answers: { item: string; rank?: number; coins?: number; impact?: number; confidence?: number; ease?: number }[] }[] } | null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Opens the names. The database writes the audit entry (who, when, why, how many) before it returns anything. The list is not kept anywhere. */
export async function revealNames(_prev: NamesState, form: FormData): Promise<NamesState> {
  const { supabase, active } = await requireWorkspace("/alignment");
  const id = String(form.get("id"));
  const reason = String(form.get("reason") ?? "").replace(/\s+/g, " ").trim();
  if (active.role !== "admin" || !UUID.test(id)) return { error: "Only admins can see names." };
  const { data, error } = await supabase.rpc("alignment_reveal_names", { p_session: id, p_reason: reason });
  if (error) return { error: error.code === "22023" ? error.message : "We could not open the names." };
  const { data: s } = await supabase.from("alignment_sessions").select("groups").eq("tenant_id", active.tenantId).eq("id", id).maybeSingle();
  const groupName = new Map(((s?.groups ?? []) as { id: string; name: string }[]).map((g) => [g.id, g.name]));
  return { rows: ((data ?? []) as { name: string | null; email: string | null; group_id: string; voted: boolean; answers: never }[]).map((r) => ({ name: r.name, email: r.email, group: groupName.get(r.group_id) ?? r.group_id, voted: r.voted, answers: r.answers })) };
}
