"use client";

import { useActionState, useState } from "react";
import { canSubmitNewPassword, NewPasswordFields, PasswordField } from "@/components/password-field";
import { signInWithProvider } from "@/app/sign-in/actions";
import { acceptInvitation, signInAndAccept, signUpForInvite, type AcceptState } from "./actions";

export function AcceptForm({ token, workspace }: { token: string; workspace: string }) {
  const [state, action, pending] = useActionState<AcceptState, FormData>(acceptInvitation, null);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="token" value={token} />
      {state?.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Joining…" : `Accept and join ${workspace}`}
      </button>
    </form>
  );
}

/**
 * Sign-in / create-account for someone who followed an invite link and is not
 * signed in. `mode` is chosen by the server page (full page load, so password
 * managers see the right kind of form from the start).
 */
export function InviteSignIn({ token, email, mode }: { token: string; email: string; mode: "sign-in" | "create" }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, action, pending] = useActionState<AcceptState, FormData>(
    mode === "sign-in" ? signInAndAccept : signUpForInvite,
    null,
  );
  const next = `/invite/${token}`;
  const canSubmit = mode === "sign-in" ? password.length > 0 : canSubmitNewPassword(password, confirm, email);
  return (
    <div className="stack">
      <form action={action} className="stack">
        <input type="hidden" name="token" value={token} />
        <div className="field">
          <label htmlFor="invite-email-shown">Email</label>
          <input
            id="invite-email-shown"
            name="email"
            type="email"
            autoComplete="username"
            value={email}
            readOnly
            aria-readonly="true"
          />
          <p className="hint">The invitation is for this address.</p>
        </div>
        {mode === "sign-in" ? (
          <PasswordField
            name="password"
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            autoFocus
          />
        ) : (
          <NewPasswordFields
            password={password}
            confirm={confirm}
            onPassword={setPassword}
            onConfirm={setConfirm}
            email={email}
            autoFocus
          />
        )}
        {state?.error && (
          <p role="alert" className="error">
            {state.error}
          </p>
        )}
        {state?.message && (
          <p role="status" className="success">
            {state.message}
          </p>
        )}
        <button className="btn btn-primary" type="submit" disabled={pending || !canSubmit}>
          {pending ? "Please wait…" : mode === "sign-in" ? "Sign in and accept" : "Create account"}
        </button>
        {/* plain links on purpose: a full page load gives password managers a fresh, correct form */}
        <a className="link-button" href={mode === "sign-in" ? "?mode=create" : "?mode=sign-in"}>
          {mode === "sign-in" ? "No account yet? Create one" : "Already have an account? Sign in"}
        </a>
      </form>

      <div className="divider" role="separator">
        <span>or</span>
      </div>
      {(["google", "github"] as const).map((provider) => (
        <form key={provider} action={signInWithProvider}>
          <input type="hidden" name="provider" value={provider} />
          <input type="hidden" name="next" value={next} />
          <button className="btn btn-wide" type="submit">
            Continue with {provider === "google" ? "Google" : "GitHub"}
          </button>
        </form>
      ))}
      <p className="hint">With Google or GitHub, use the account that has the email address above.</p>
    </div>
  );
}
