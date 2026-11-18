"use client";
import { useActionState } from "react";
import { EA_ROLES, EA_TEAMS } from "./early-access";
import { requestEarlyAccess, type EarlyAccessState } from "./actions";

const idle: EarlyAccessState = { status: "idle" };

export function EarlyAccessForm() {
  const [state, action, pending] = useActionState(requestEarlyAccess, idle);
  if (state.status === "sent") {
    return (
      <div className="thanks" role="status" tabIndex={-1}>
        <b>Thanks, you are on the list.</b>
        <p>We will be in touch about early access.</p>
      </div>
    );
  }
  const err = state.status === "invalid" ? state.errors : {};
  const field = (k: keyof typeof err) => (err[k] ? { "aria-invalid": true as const, "aria-describedby": `ea-${k}-e` } : {});
  return (
    <form className="ea" action={action} noValidate>
      <div className="fld"><label htmlFor="ea-name">Name</label><input id="ea-name" name="name" autoComplete="name" maxLength={120} {...field("name")} /><div className="err" id="ea-name-e" role="alert">{err.name}</div></div>
      <div className="fld"><label htmlFor="ea-email">Work email</label><input id="ea-email" name="email" type="email" autoComplete="email" maxLength={200} {...field("email")} /><div className="err" id="ea-email-e" role="alert">{err.email}</div></div>
      <div className="fld"><label htmlFor="ea-company">Company</label><input id="ea-company" name="company" autoComplete="organization" maxLength={160} {...field("company")} /><div className="err" id="ea-company-e" role="alert">{err.company}</div></div>
      <div className="row2">
        <div className="fld"><label htmlFor="ea-role">Your role</label>
          <select id="ea-role" name="role" defaultValue="" {...field("role")}><option value="">Choose one</option>{EA_ROLES.map((r) => <option key={r}>{r}</option>)}</select>
          <div className="err" id="ea-role-e" role="alert">{err.role}</div></div>
        <div className="fld"><label htmlFor="ea-teams">Number of product teams</label>
          <select id="ea-teams" name="teams" defaultValue=""><option value="">Choose one</option>{EA_TEAMS.map((t) => <option key={t}>{t}</option>)}</select><div className="err" aria-hidden="true" /></div>
      </div>
      {/* hidden from people, filled by bots */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", height: 0, overflow: "hidden" }}><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      {state.status === "failed" && <p className="err" role="alert">{state.message}</p>}
      <button className="btn btn-p" type="submit" disabled={pending}>{pending ? "Sending…" : "Get early access"}</button>
      <p className="fine">We use your details only to contact you about early access.</p>
    </form>
  );
}
