import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/session";
import { buildParticipantEmail, MAILING_STATE_LABEL } from "@/lib/alignment-mail";
import { cancelMailing, confirmAndSend, continueSending, saveMailing } from "../../../actions";

export const metadata = { title: "Invitation · Product Velocity" };
/** Sending runs inside the request that confirms it; the rest is picked up with "Continue sending". */
export const maxDuration = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function MailingPage({ params, searchParams }: { params: Promise<{ id: string; mid: string }>; searchParams: Promise<{ notice?: string }> }) {
  const { id, mid } = await params;
  const { notice } = await searchParams;
  if (!UUID.test(id) || !UUID.test(mid)) notFound();
  const { supabase, active } = await requireWorkspace(`/alignment/${id}/mail/${mid}`);
  if (active.role !== "admin") notFound();
  const { data: m } = await supabase.from("alignment_mailings").select("*").eq("tenant_id", active.tenantId).eq("session_id", id).eq("id", mid).maybeSingle();
  const { data: s } = await supabase.from("alignment_sessions").select("name, status, closes_at").eq("tenant_id", active.tenantId).eq("id", id).maybeSingle();
  if (!m || !s) notFound();
  const kind = m.kind as "invitation" | "reminder";
  const n = (m.recipient_ids as string[]).length;
  const sample = buildParticipantEmail({ kind, subject: m.subject, body: m.body }, { name: "Alex", session: s.name, closesAt: s.closes_at, link: "https://…/a/your-personal-link", unsubscribe: "https://…/a/your-personal-link/unsubscribe" });
  const open = s.status === "open";
  const left = Math.max(n - m.sent_count - m.failed_count, 0);

  return (
    <div className="page-narrow">
      <p><Link href={`/alignment/${id}`}>← {s.name}</Link></p>
      <h1>{kind === "invitation" ? "Invitation" : "Reminder"}</h1>
      <p><strong>{MAILING_STATE_LABEL[m.status] ?? m.status}</strong> · {n} {n === 1 ? "person" : "people"}{m.status !== "draft" ? ` · ${m.sent_count} sent${m.failed_count ? `, ${m.failed_count} not sent` : ""}` : ""}</p>
      {m.created_via === "Claude MCP" && <p className="notice">Claude drafted this text. Read it before you confirm: nothing is sent until you do.</p>}
      {notice && <p role="status" className="notice">{notice === "saved" ? "Saved." : notice}</p>}

      <h2>Text</h2>
      <form action={saveMailing} className="card stack">
        <input type="hidden" name="session" value={id} />
        <input type="hidden" name="id" value={mid} />
        <fieldset disabled={m.status !== "draft"} className="stack">
          <label>Subject<input name="subject" defaultValue={m.subject} maxLength={150} required /></label>
          <label>Message<textarea name="body" rows={9} defaultValue={m.body} maxLength={4000} required /></label>
          <p className="muted">You can use {"{{name}}"}, {"{{session}}"} and {"{{closes}}"}. Each person&rsquo;s own link is added at the end{kind === "reminder" ? ", with a way to stop reminders" : ""}. There are no images and no tracking.</p>
        </fieldset>
        {m.status === "draft" && <div><button className="btn" type="submit">Save changes</button></div>}
      </form>

      <h2>Preview as a participant</h2>
      <div className="card stack" aria-label="Email preview">
        <p><strong>{sample.subject}</strong></p>
        <pre className="mail-preview">{sample.text}</pre>
      </div>

      {m.status === "draft" && (
        <>
          <h2>Confirm</h2>
          <div className="card stack">
            {!open && <p role="alert" className="error">The session is {s.status}. Open it before you send; participants cannot vote in a draft session.</p>}
            <p>This sends {n === 1 ? "one email" : `${n} emails`}. Nothing is sent until you press the button.</p>
            <form action={confirmAndSend} className="row-form">
              <input type="hidden" name="session" value={id} />
              <input type="hidden" name="id" value={mid} />
              <input type="hidden" name="expected" value={n} />
              <button className="btn btn-primary" type="submit" disabled={!open}>Confirm and send to {n} {n === 1 ? "person" : "people"}</button>
            </form>
            <form action={cancelMailing}>
              <input type="hidden" name="session" value={id} />
              <input type="hidden" name="id" value={mid} />
              <button className="btn" type="submit">Cancel this mailing</button>
            </form>
          </div>
        </>
      )}
      {(m.status === "confirmed" || m.status === "sending") && left > 0 && (
        <form action={continueSending} className="card stack">
          <input type="hidden" name="session" value={id} />
          <input type="hidden" name="id" value={mid} />
          <p>{left} still to send.</p>
          <div><button className="btn btn-primary" type="submit">Continue sending</button></div>
        </form>
      )}
    </div>
  );
}
