"use client";

import { useActionState, useState, useTransition } from "react";
import { ROLES, ROLE_HELP, ROLE_LABEL, type Role } from "@/lib/roles";
import { createInvitation, updateMember, type InviteState } from "./actions";

export function InviteForm() {
  const [state, action, pending] = useActionState<InviteState, FormData>(createInvitation, null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="stack">
      <form action={action} className="row-form">
        <div className="field">
          <label htmlFor="invite-email">Email</label>
          <input id="invite-email" name="email" type="email" required />
        </div>
        <div className="field">
          <label htmlFor="invite-role">Role</label>
          <select id="invite-role" name="role" defaultValue="creator">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]} · {ROLE_HELP[r]}
              </option>
            ))}
          </select>
        </div>
        <label className="check">
          <input type="checkbox" name="is_approver" /> Approver
        </label>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create invite link"}
        </button>
      </form>
      {state?.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      {state?.link && (
        <div role="status" className="notice">
          <p>
            Invite link for <strong>{state.email}</strong>. Send it to them yourself, we have not
            emailed anything. It works once, for that email address, for 7 days. It will not be
            shown again.
          </p>
          <div className="row-form">
            <input readOnly value={state.link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
            <button
              className="btn"
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(state.link!);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
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
