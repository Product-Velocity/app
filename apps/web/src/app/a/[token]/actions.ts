"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { generateInviteToken, hashInviteToken } from "@/lib/auth/invite-token";
import { CONSENT_VERSION } from "@/lib/alignment";
import { buildNewLinkEmail } from "@/lib/alignment-mail";
import { browserCookie, hashSecret, newBrowserSecret, resolveLink, sameBrowser } from "@/lib/alignment-link";
import { sendEmail } from "@/lib/email/resend";
import { siteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";

export type LinkResult = { ok?: string; error?: string } | null;

/** "I agree and continue": records consent and ties the link to this browser (a cookie only this browser holds). */
export async function joinSession(token: string): Promise<LinkResult> {
  const s = await resolveLink(token);
  if (s.kind !== "ok") return { error: "This link is not valid any more." };
  if (s.session.status !== "open") return { error: "This session is not open." };
  const p = s.participant;
  if (p.browser_hash) return { error: "This link was already opened in another browser." };
  const secret = newBrowserSecret();
  const admin = createAdminClient({ via: "system" });
  const closes = s.session.closes_at ? new Date(s.session.closes_at) : null;
  const { error } = await admin.from("alignment_participants")
    .update({ browser_hash: hashSecret(secret), bound_at: new Date().toISOString(), consent_at: p.consent_at ?? new Date().toISOString(), consent_version: CONSENT_VERSION })
    .eq("id", p.id).is("browser_hash", null);
  if (error) return { error: "We could not save that. Please try again." };
  (await cookies()).set(browserCookie(p.id), secret, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/a", expires: closes && closes.getTime() > Date.now() ? new Date(closes.getTime() + 7 * 86400_000) : new Date(Date.now() + 90 * 86400_000) });
  revalidatePath(`/a/${token}`);
  return { ok: "joined" };
}

/**
 * A person asks for a new link (replaced, opened in another browser). The answer is always the same, so nobody learns whether an
 * address exists. The database refuses people who were never invited, more than one email a minute and more than six in all.
 */
export async function requestNewLink(token: string): Promise<LinkResult> {
  const generic: LinkResult = { ok: "If this link belongs to someone who was invited, a new one is on its way to their email address." };
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return generic;
  const admin = createAdminClient({ via: "system" });
  const next = generateInviteToken();
  const { data } = await admin.rpc("alignment_link_resend", { p_old_hash: hashInviteToken(token), p_new_hash: hashInviteToken(next) });
  const row = (data as { id: string; email: string; name: string | null; session_name: string; closes_at: string | null }[] | null)?.[0];
  if (!row) return generic;
  const mail = buildNewLinkEmail({ name: row.name, session: row.session_name, closesAt: row.closes_at, link: `${await siteUrl()}/a/${next}` });
  const sent = await sendEmail({ to: row.email, ...mail });
  if (!sent.ok) console.error(JSON.stringify({ alignment: "new-link", ok: false }));
  return generic;
}

/** Stops reminders (the invitation was already sent). Idempotent. */
export async function stopReminders(token: string): Promise<LinkResult> {
  const s = await resolveLink(token);
  if (s.kind === "unknown") return { error: "This link is not valid any more." };
  const admin = createAdminClient({ via: "system" });
  // an older reminder's link still stops reminders, even after a newer link replaced it
  const id = s.kind === "ok" ? s.participant.id : s.participantId;
  await admin.from("alignment_participants").update({ unsubscribed_at: new Date().toISOString() }).eq("id", id).is("unsubscribed_at", null);
  return { ok: "You will not get any more reminders for this session." };
}

/** The person behind a link, only if the link is current, the session is open and this is the browser it was first opened in. */
async function ballotOwner(token: string) {
  const link = await resolveLink(token);
  if (link.kind !== "ok" || link.session.status !== "open" || !link.participant.consent_at) return null;
  if (!(await sameBrowser(link.participant))) return null;
  return link.participant.id;
}

/** Saves what the person has picked so far. A save older than the stored one is ignored, so reloads and slow networks cannot undo newer answers. */
export async function saveBallotProgress(token: string, progress: unknown, revision: number): Promise<{ ok: boolean; revision?: number }> {
  const id = await ballotOwner(token);
  if (!id || !Number.isInteger(revision) || revision < 0 || revision > 1_000_000) return { ok: false };
  const admin = createAdminClient({ via: "system" });
  const { data, error } = await admin.rpc("alignment_ballot_save", { p_participant: id, p_progress: progress, p_revision: revision });
  return error ? { ok: false } : { ok: true, revision: data as number };
}

/** Submits or changes the vote. The database checks the answers against the session's method; the message is safe to show. */
export async function submitBallot(token: string, answers: unknown, revision: number): Promise<{ ok: boolean; error?: string }> {
  const id = await ballotOwner(token);
  if (!id || !Number.isInteger(revision) || revision < 0 || revision > 1_000_000) return { ok: false, error: "This link no longer works here. Open your latest email." };
  const admin = createAdminClient({ via: "system" });
  const { error } = await admin.rpc("alignment_ballot_submit", { p_participant: id, p_answers: answers, p_revision: revision });
  if (error) return { ok: false, error: error.code === "22023" ? error.message.slice(0, 160) : "We could not save your vote. Please try again." };
  return { ok: true };
}
