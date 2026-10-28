"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { ROLES, ROLE_HELP, ROLE_LABEL, type Role } from "@/lib/roles";
import { createInvitation, resendInvitation, setMemberGithubUsername, updateMember, type InviteState } from "./actions";

/**
 * Invite someone in two steps: fill in, then review. Nothing is sent until the admin confirms in the review: "Send invitation email"
 * emails the link, "Create link only" emails nothing and shows the link to copy.
 */
export function InviteForm({ workspaceName, emailEnabled }: { workspaceName: string; emailEnabled: boolean }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(createInvitation, null);
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("creator");
  const [approver, setApprover] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const review = () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setProblem("Enter a valid email address."); return; }
    setProblem(null); setStep("review");
  };
  const done = !!state?.link;
  return (
    <div className="stack">
      <form ref={formRef} action={(f) => { action(f); setStep("edit"); }} className={step === "edit" ? "row-form" : "stack"}>
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="role" value={role} />
        {approver && <input type="hidden" name="is_approver" value="on" />}
        {step === "edit" ? (
          <>
            <div className="field">
              <label htmlFor="invite-email">Email</label>
              <input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="invite-role">Role</label>
              <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]} · {ROLE_HELP[r]}</option>)}
              </select>
            </div>
            <label className="check"><input type="checkbox" checked={approver} onChange={(e) => setApprover(e.target.checked)} /> Approver</label>
            <button className="btn btn-primary" type="button" onClick={review}>Review invitation</button>
          </>
        ) : (
          <div className="notice" role="group" aria-label="Review the invitation">
            <p><strong>Review before anything is sent.</strong></p>
            <dl className="plain-dl">
              <dt>To</dt><dd>{email.trim().toLowerCase()}</dd>
              <dt>Workspace</dt><dd>{workspaceName}</dd>
              <dt>Role</dt><dd>{ROLE_LABEL[role]}{approver ? " · Approver" : ""}</dd>
              <dt>The link</dt><dd>works once, only for that email address, and expires in 7 days</dd>
            </dl>
            <div className="row-form">
              {emailEnabled
                ? <button className="btn btn-primary" type="submit" name="delivery" value="email" disabled={pending}>{pending ? "Sending…" : "Send invitation email"}</button>
                : <span className="muted">Email is not set up on this deployment yet, so the link has to be sent by you.</span>}
              <button className={emailEnabled ? "btn" : "btn btn-primary"} type="submit" name="delivery" value="link" disabled={pending}>Create link only</button>
              <button className="btn" type="button" onClick={() => setStep("edit")}>Back</button>
            </div>
          </div>
        )}
      </form>
      {problem && <p role="alert" className="error">{problem}</p>}
      {state?.error && <p role="alert" className="error">{state.error}</p>}
      {done && <LinkNotice state={state!} />}
    </div>
  );
}

function LinkNotice({ state }: { state: NonNullable<InviteState> }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="notice">
      <p>
        {state.emailed ? <>We emailed <strong>{state.email}</strong>. </> : state.emailNote ? <>We did not email <strong>{state.email}</strong>: {state.emailNote} </> : <>Invite link for <strong>{state.email}</strong>. We have not emailed anything. </>}
        The link works once, for that email address, for 7 days. It will not be shown again.
      </p>
      <div className="row-form">
        <input readOnly value={state.link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
        <button className="btn" type="button" onClick={async () => { await navigator.clipboard.writeText(state.link!); setCopied(true); }}>{copied ? "Copied" : "Copy"}</button>
      </div>
    </div>
  );
}

/** Resend a pending invitation: a new link (the old one stops working), emailed or not. */
export function ResendControls({ id, emailEnabled }: { id: string; emailEnabled: boolean }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(resendInvitation, null);
  return (
    <div className="stack">
      <form action={action} className="row-form">
        <input type="hidden" name="id" value={id} />
        {emailEnabled && <button className="btn" type="submit" name="delivery" value="email" disabled={pending}>{pending ? "Sending…" : "Resend email"}</button>}
        <button className="btn" type="submit" name="delivery" value="link" disabled={pending} title="Makes a new link and stops the old one">New link</button>
      </form>
      {state?.error && <p role="alert" className="error">{state.error}</p>}
      {state?.link && <LinkNotice state={state} />}
    </div>
  );
}

export function MemberControls(props: { memberId: string; role: Role; isApprover: boolean; disabled: boolean }) {
  const [role, setRole] = useState<Role>(props.role);
  const [approver, setApprover] = useState(props.isApprover);
  const [status, setStatus] = useState<string>("");
  const [, startTransition] = useTransition();

  function save(nextRole: Role, nextApprover: boolean) {
    const prev = { role, approver };
    setRole(nextRole);
    setApprover(nextApprover);
    setStatus("Saving…");
    startTransition(async () => {
      const result = await updateMember(props.memberId, nextRole, nextApprover);
      if (result.ok) {
        setStatus("Saved");
      } else {
        setRole(prev.role);
        setApprover(prev.approver);
        setStatus(result.error);
      }
    });
  }

  return (
    <>
      <td>
        <select
          aria-label="Role"
          value={role}
          disabled={props.disabled}
          onChange={(e) => save(e.target.value as Role, approver)}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </td>
      <td>
        <label className="check">
          <input
            type="checkbox"
            checked={approver}
            disabled={props.disabled}
            onChange={(e) => save(role, e.target.checked)}
          />{" "}
          Approver
        </label>
        <span className="status" role="status" aria-live="polite">
          {status}
        </span>
      </td>
    </>
  );
}

/** The GitHub username of a member, edited by an admin (it matches the person with the assignees of GitHub issues). */
export function MemberGithubUsername({ userId, current, label }: { userId: string; current: string; label: string }) {
  const [value, setValue] = useState(current);
  const [status, setStatus] = useState("");
  const [, startTransition] = useTransition();
  const save = () => {
    if (value.trim() === current) return;
    setStatus("Saving…");
    startTransition(async () => {
      const r = await setMemberGithubUsername(userId, value);
      setStatus(r.ok ? "Saved" : r.error);
    });
  };
  return (
    <>
      <input aria-label={`GitHub username of ${label}`} value={value} maxLength={40} autoComplete="off" spellCheck={false} placeholder="none" onChange={(e) => setValue(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }} />
      <span role="status" className="muted" aria-live="polite"> {status}</span>
    </>
  );
}
