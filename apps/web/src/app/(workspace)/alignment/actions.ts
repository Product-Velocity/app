"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { METHODS, NEXT_STATE, validateSettings, type SessionState } from "@/lib/alignment";
import { requireWorkspace } from "@/lib/session";
import { DEFAULT_TEXT, parseParticipants } from "@/lib/alignment-mail";
import { sendMailing } from "@/lib/alignment-send";
import { serverSendDeps } from "@/lib/alignment-send-server";
import type { Group } from "@/lib/alignment";

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

export type PeopleState = { ok?: string; error?: string; problems?: string[] } | null;

/** Adds the people pasted into the box (admins). Duplicates are merged; lines that cannot be read are listed by line number. */
export async function addParticipants(_prev: PeopleState, form: FormData): Promise<PeopleState> {
  const { supabase, active } = await requireWorkspace(PATH);
  const id = String(form.get("id"));
  if (active.role !== "admin" || !UUID.test(id)) return { error: "Only admins can add participants." };
  const { data: s } = await supabase.from("alignment_sessions").select("groups").eq("tenant_id", active.tenantId).eq("id", id).maybeSingle();
  if (!s) return { error: "Session not found." };
  const groups = s.groups as Group[];
  const defaultGroup = String(form.get("default_group") ?? "");
  if (!groups.some((g) => g.id === defaultGroup)) return { error: "Choose the group for people without one." };
  const parsed = parseParticipants(String(form.get("people") ?? ""), groups, defaultGroup);
  if (parsed.rows.length === 0) return { error: parsed.problems[0] ?? "Paste at least one email address.", problems: parsed.problems.slice(1, 10) };
  const { data, error } = await supabase.rpc("alignment_participants_add", { p_session: id, p_rows: parsed.rows });
  if (error) return { error: error.code === "22023" ? error.message : "We could not add the people." };
  revalidatePath(`${PATH}/${id}`);
  const r = data as { added: number; merged: number; invalid: number };
  return { ok: `Added ${r.added}${r.merged ? `, ${r.merged} already there` : ""}.`, problems: parsed.problems.slice(0, 10) };
}

export async function removeParticipant(form: FormData): Promise<void> {
  const { supabase, active } = await requireWorkspace(PATH);
  const id = String(form.get("id")), session = String(form.get("session"));
  if (active.role !== "admin" || !UUID.test(id) || !UUID.test(session)) redirect(`${PATH}/${session}?status=not-allowed`);
  await supabase.rpc("alignment_participant_remove", { p_id: id });
  revalidatePath(`${PATH}/${session}`);
  redirect(`${PATH}/${session}?status=person-removed`);
}

/** Starts a draft invitation or reminder with the standard text. Nothing is sent; the next page is where a person confirms. */
export async function startMailing(form: FormData): Promise<void> {
  const { supabase, active } = await requireWorkspace(PATH);
  const session = String(form.get("session")), kind = String(form.get("kind"));
  if (active.role !== "admin" || !UUID.test(session) || (kind !== "invitation" && kind !== "reminder")) redirect(`${PATH}/${session}?status=not-allowed`);
  const t = DEFAULT_TEXT[kind];
  const { data, error } = await supabase.rpc("alignment_mailing_draft", { p_session: session, p_kind: kind, p_subject: t.subject, p_body: t.body });
  if (error || !data) redirect(`${PATH}/${session}?status=${encodeURIComponent(error?.code === "22023" ? error.message.slice(0, 120) : "We could not prepare the mailing.")}`);
  redirect(`${PATH}/${session}/mail/${data as string}`);
}

const MAIL = (session: string, id: string) => `${PATH}/${session}/mail/${id}`;

export async function saveMailing(form: FormData): Promise<void> {
  const { supabase, active } = await requireWorkspace(PATH);
  const session = String(form.get("session")), id = String(form.get("id"));
  if (active.role !== "admin" || !UUID.test(session) || !UUID.test(id)) redirect(`${PATH}/${session}?status=not-allowed`);
  const subject = String(form.get("subject") ?? "").trim(), body = String(form.get("body") ?? "").trim();
  if (subject.length < 1 || subject.length > 150 || body.length < 1 || body.length > 4000) redirect(`${MAIL(session, id)}?notice=${encodeURIComponent("The subject needs 1 to 150 characters and the text 1 to 4000.")}`);
  const { error } = await supabase.rpc("alignment_mailing_edit", { p_id: id, p_subject: subject, p_body: body });
  revalidatePath(MAIL(session, id));
  redirect(`${MAIL(session, id)}?notice=${error ? encodeURIComponent(error.code === "22023" ? error.message : "We could not save.") : "saved"}`);
}

export async function cancelMailing(form: FormData): Promise<void> {
  const { supabase, active } = await requireWorkspace(PATH);
  const session = String(form.get("session")), id = String(form.get("id"));
  if (active.role !== "admin" || !UUID.test(session) || !UUID.test(id)) redirect(`${PATH}/${session}?status=not-allowed`);
  const { error } = await supabase.rpc("alignment_mailing_cancel", { p_id: id });
  revalidatePath(PATH + "/" + session);
  redirect(error ? `${MAIL(session, id)}?notice=${encodeURIComponent(error.message.slice(0, 120))}` : `${PATH}/${session}?status=mailing-cancelled`);
}

/** The confirm step: a signed-in person presses the button. Confirming checks the number they saw, then the emails go out. */
export async function confirmAndSend(form: FormData): Promise<void> {
  const { supabase, active } = await requireWorkspace(PATH);
  const session = String(form.get("session")), id = String(form.get("id"));
  const expected = Number(form.get("expected"));
  if (active.role !== "admin" || active.platform || !UUID.test(session) || !UUID.test(id) || !Number.isInteger(expected)) redirect(`${PATH}/${session}?status=not-allowed`);
  const { error } = await supabase.rpc("alignment_mailing_confirm", { p_id: id, p_expected: expected });
  if (error) redirect(`${MAIL(session, id)}?notice=${encodeURIComponent(error.code === "22023" ? error.message : error.code === "PV004" ? "Only a person can confirm sending." : "We could not confirm.")}`);
  await runSending(session, id);
}

/** Sends what is left of a confirmed mailing (after a pause for time or the email service's limit). */
export async function continueSending(form: FormData): Promise<void> {
  const { active } = await requireWorkspace(PATH);
  const session = String(form.get("session")), id = String(form.get("id"));
  if (active.role !== "admin" || active.platform || !UUID.test(session) || !UUID.test(id)) redirect(`${PATH}/${session}?status=not-allowed`);
  await runSending(session, id);
}

async function runSending(session: string, id: string): Promise<never> {
  const report = await sendMailing(id, await serverSendDeps());
  revalidatePath(PATH + "/" + session);
  revalidatePath(MAIL(session, id));
  const note = report.stopped ? `${report.sent} sent, ${report.failed} not sent. ${report.stopped}` : `${report.sent} sent${report.failed ? `, ${report.failed} not sent` : ""}.`;
  redirect(`${MAIL(session, id)}?notice=${encodeURIComponent(note)}`);
}
