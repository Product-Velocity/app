"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentPlatformEntry, requirePlatformAdmin } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/site-url";
import { sendLogged } from "@/lib/email/send";
import { forgetEmailOverride } from "@/lib/email/override";
import { emailConfigured } from "@/lib/email/resend";
import { EMAIL_TEMPLATES, renderTemplate, type EmailKey, type TemplateText } from "@/lib/email/registry/registry";
import { sampleValues } from "@/lib/email/registry/macros";
import { editableFields, validateTemplateText } from "@/lib/email/registry/validate";

/** Test sends per person per hour. */
export const TEST_SENDS_PER_HOUR = 5;

const find = (key: string) => EMAIL_TEMPLATES.find((t) => t.key === key);
const back = (key: string, notice: string, extra?: string) => `/platform/emails/${encodeURIComponent(key)}?notice=${notice}${extra ? `&${extra}` : ""}`;

/** Reads the six wording fields from the form; a field that is not editable keeps the code default. */
function readText(key: string, form: FormData): TemplateText | null {
  const t = find(key);
  if (!t) return null;
  const editable = editableFields(t);
  const get = (f: keyof TemplateText, fallback: string | null) => (editable.includes(f) ? (form.get(f) as string | null) ?? fallback ?? "" : fallback);
  return {
    subject: get("subject", t.subject)!,
    preheader: get("preheader", t.preheader)!,
    heading: get("heading", t.heading)!,
    body: get("body", t.body)!,
    button: t.button === null ? null : get("button", t.button),
    note: get("note", t.note)!,
  };
}

/** Saves the draft. The wording rules are checked first (no HTML, no typed links, only the macros this email allows). A draft never affects sending. */
export async function saveDraft(key: string, form: FormData) {
  const { supabase } = await requirePlatformAdmin(`/platform/emails/${encodeURIComponent(key)}`);
  const t = find(key); const text = readText(key, form);
  if (!t || !text) redirect("/platform/emails");
  if (validateTemplateText(t, text).length > 0) redirect(back(key, "invalid"));
  const { error } = await supabase.rpc("platform_email_save_draft", { p_key: key, p_subject: text.subject, p_preheader: text.preheader, p_heading: text.heading, p_body: text.body, p_button: text.button, p_note: text.note });
  if (error) redirect(back(key, "failed"));
  revalidatePath(`/platform/emails/${encodeURIComponent(key)}`);
  redirect(back(key, "saved"));
}

export async function discardDraft(key: string) {
  const { supabase } = await requirePlatformAdmin(`/platform/emails/${encodeURIComponent(key)}`);
  if (!find(key)) redirect("/platform/emails");
  const { error } = await supabase.rpc("platform_email_discard_draft", { p_key: key });
  redirect(back(key, error ? "failed" : "discarded"));
}

/** Publishes the draft (written to the platform audit log by the database). The new wording is sent from now on. */
export async function publishDraft(key: string) {
  const { supabase } = await requirePlatformAdmin(`/platform/emails/${encodeURIComponent(key)}`);
  if (!find(key)) redirect("/platform/emails");
  const { error } = await supabase.rpc("platform_email_publish", { p_key: key });
  if (error) redirect(back(key, error.code === "22023" ? "no-draft" : "failed"));
  forgetEmailOverride(key as EmailKey);
  revalidatePath(`/platform/emails/${encodeURIComponent(key)}`);
  redirect(back(key, "published"));
}

/** Restores an older version as a new published version (written to the platform audit log by the database). */
export async function restoreVersion(key: string, version: number) {
  const { supabase } = await requirePlatformAdmin(`/platform/emails/${encodeURIComponent(key)}`);
  if (!find(key) || !Number.isInteger(version)) redirect("/platform/emails");
  const { error } = await supabase.rpc("platform_email_restore", { p_key: key, p_version: version });
  if (error) redirect(back(key, "failed"));
  forgetEmailOverride(key as EmailKey);
  revalidatePath(`/platform/emails/${encodeURIComponent(key)}`);
  redirect(back(key, "restored"));
}

/**
 * Sends the wording in the form (not yet published) to the signed-in platform admin's OWN address and nowhere else, with sample data and
 * "Test: " in front of the subject. Rate limited per person per hour. The address is the session's, never read from the form.
 */
export async function sendTest(key: string, form: FormData) {
  const { supabase, user } = await requirePlatformAdmin(`/platform/emails/${encodeURIComponent(key)}`);
  // impersonation can never send (CLAUDE.md rule 10): leave the customer account first
  if (await currentPlatformEntry(supabase)) redirect(back(key, "in-account"));
  const t = find(key); const text = readText(key, form);
  if (!t || !text) redirect("/platform/emails");
  if (!emailConfigured()) redirect(back(key, "no-email"));
  if (!user.email) redirect(back(key, "failed"));
  if (validateTemplateText(t, text).length > 0) redirect(back(key, "invalid"));
  const admin = createAdminClient({ via: "system" });
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from("email_send_log").select("id", { count: "exact", head: true }).eq("is_test", true).eq("actor_id", user.id).gte("created_at", since);
  if ((count ?? 0) >= TEST_SENDS_PER_HOUR) redirect(back(key, "limit"));
  const site = await siteUrl();
  // a test never carries a real token: the button goes to the front page
  const r = renderTemplate(t, { values: { ...sampleValues(t.macros), ...(t.sample ?? {}) }, siteUrl: site, buttonUrl: t.button ? `${site}/` : null, override: text });
  const sent = await sendLogged(key as EmailKey, { to: user.email, subject: `Test: ${r.subject}`, text: r.text, html: r.html }, { isTest: true, actorId: user.id });
  redirect(back(key, sent.ok ? "test-sent" : "test-failed"));
}
