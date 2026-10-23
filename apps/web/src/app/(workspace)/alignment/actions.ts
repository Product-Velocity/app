"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { METHODS, NEXT_STATE, validateSettings, type SessionState } from "@/lib/alignment";
import { requireWorkspace } from "@/lib/session";

export type FormState = { ok?: string; error?: string } | null;
const PATH = "/alignment";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Creates a draft session from the selected initiatives (admins). The settings come next, on the session page. */
export async function createAlignmentSession(ids: string[], name: string, method: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { supabase, active } = await requireWorkspace(PATH);
  if (active.role !== "admin") return { ok: false, error: "Only admins can create alignment sessions." };
  if (!Array.isArray(ids) || ids.length < 2 || ids.length > 100 || !ids.every((i) => typeof i === "string" && UUID.test(i))) return { ok: false, error: "Choose between 2 and 100 initiatives." };
  const clean = String(name ?? "").replace(/\s+/g, " ").trim();
  if (clean.length < 1 || clean.length > 120) return { ok: false, error: "Give the session a name of up to 120 characters." };
  if (!METHODS.some((m) => m.value === method)) return { ok: false, error: "Choose a method." };
  const { data, error } = await supabase.rpc("alignment_session_create", { p_name: clean, p_method: method, p_item_ids: ids });
  if (error || !data) return { ok: false, error: error?.code === "22023" ? error.message : "We could not create the session." };
  revalidatePath(PATH);
  return { ok: true, id: data as string };
}

export async function saveSettings(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, active } = await requireWorkspace(PATH);
  const id = String(form.get("id"));
  if (active.role !== "admin" || !UUID.test(id)) return { error: "Only admins can change a session." };
  const v = validateSettings({
    name: form.get("name"), method: form.get("method"), groups: form.get("groups"), weighting: form.get("weighting"), excluded: form.getAll("excluded"),
    coinsTotal: form.get("coins_total"), coinsMax: form.get("coins_max"), showResults: form.get("show_results") === "on", retention: form.get("retention"), closesAt: form.get("closes_at_iso"),
  });
  if (!v.ok) return { error: v.error };
  const s = v.settings;
  const { error } = await supabase.rpc("alignment_session_configure", {
    p_id: id, p_name: s.name, p_method: s.method, p_groups: s.groups, p_weighting: s.weighting, p_excluded: s.excluded, p_coins_total: s.coinsTotal, p_coins_max: s.coinsMax,
    p_show_results: s.showResults, p_retention: s.retentionMonths, p_closes_at: s.closesAt,
  });
  if (error) return { error: error.code === "PV009" ? "The settings of an open session are locked. Make a new session instead." : "We could not save the settings." };
  revalidatePath(`${PATH}/${id}`);
  return { ok: "Saved." };
}

/** One step forward: open, close or archive. The database checks the order. */
export async function changeState(form: FormData): Promise<void> {
  const { supabase, active } = await requireWorkspace(PATH);
  const id = String(form.get("id"));
  const to = String(form.get("to")) as SessionState;
  if (active.role !== "admin" || !UUID.test(id) || !Object.values(NEXT_STATE).some((n) => n?.to === to)) redirect(`${PATH}/${id}?status=not-allowed`);
  const { error } = await supabase.rpc("alignment_session_set_state", { p_id: id, p_state: to });
  revalidatePath(`${PATH}/${id}`);
  revalidatePath(PATH);
  redirect(`${PATH}/${id}?status=${error ? (error.code === "22023" ? encodeURIComponent(error.message.slice(0, 120)) : "failed") : to}`);
}
