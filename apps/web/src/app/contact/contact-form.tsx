"use client";
import { useActionState } from "react";
import { CONTACT_SUBJECTS } from "./contact";
import { requestContact, type ContactState } from "./actions";

const idle: ContactState = { status: "idle" };

export function ContactForm({ subject }: { subject: string }) {
  const [state, action, pending] = useActionState(requestContact, idle);
  if (state.status === "sent") {
    return (
      <div className="contact-thanks" role="status" tabIndex={-1}>
        <b>Thanks, your message is on its way.</b>
        <p>We will reply to the address you gave.</p>
      </div>
    );
  }
  const err = state.status === "invalid" ? state.errors : {};
  const field = (k: keyof typeof err) => (err[k] ? { "aria-invalid": true as const, "aria-describedby": `ct-${k}-e` } : {});
  return (
    <form className="contact-form" action={action} noValidate>
      <div className="fld"><label htmlFor="ct-name">Name</label><input id="ct-name" name="name" autoComplete="name" maxLength={120} {...field("name")} /><div className="err" id="ct-name-e" role="alert">{err.name}</div></div>
      <div className="fld"><label htmlFor="ct-email">Email</label><input id="ct-email" name="email" type="email" autoComplete="email" maxLength={200} {...field("email")} /><div className="err" id="ct-email-e" role="alert">{err.email}</div></div>
      <div className="fld"><label htmlFor="ct-subject">What is this about?</label>
        <select id="ct-subject" name="subject" defaultValue={subject} {...field("subject")}><option value="">Choose one</option>{CONTACT_SUBJECTS.map((s) => <option key={s.slug}>{s.label}</option>)}</select>
        <div className="err" id="ct-subject-e" role="alert">{err.subject}</div></div>
      <div className="fld"><label htmlFor="ct-message">Message</label><textarea id="ct-message" name="message" rows={6} maxLength={4000} {...field("message")} /><div className="err" id="ct-message-e" role="alert">{err.message}</div></div>
      {/* hidden from people, filled by bots */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", height: 0, overflow: "hidden" }}><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      {state.status === "failed" && <p className="err" role="alert">{state.message}</p>}
      <button className="btn" type="submit" disabled={pending}>{pending ? "Sending…" : "Send message"}</button>
      <p className="fine">Do not send passwords or document text. We use your details only to answer you.</p>
    </form>
  );
}
