"use client";

import { useActionState, useState } from "react";
import { canSubmitNewPassword, NewPasswordFields } from "@/components/password-field";
import { setNewPassword, type ResetState } from "./actions";

/** `email` is shown read-only so password managers save the new password against the right login. */
export function ResetForm({ email }: { email: string }) {
  const [password, setPassword] = useState("");
  const [state, action, pending] = useActionState<ResetState, FormData>(setNewPassword, null);
  return (
    <form action={action} className="stack">
      <div>
        <h1>Choose a new password</h1>
        <p className="sub">Pick the one your password manager suggests, or a long passphrase.</p>
      </div>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" value={email} readOnly aria-readonly="true" />
      </div>
      <NewPasswordFields password={password} onPassword={setPassword} email={email} label="New password" autoFocus />
      {state?.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      <button className="btn btn-primary" type="submit" disabled={pending || !canSubmitNewPassword(password, email)}>
        {pending ? "Please wait…" : "Set password and sign in"}
      </button>
    </form>
  );
}
