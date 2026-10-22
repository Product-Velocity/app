"use client";

import { useActionState, useState } from "react";
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

/** Sign-in / sign-up for someone who followed an invite link and is not signed in. */
export function InviteSignIn({ token, email }: { token: string; email: string }) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [state, action, pending] = useActionState<AcceptState, FormData>(
    mode === "sign-in" ? signInAndAccept : signUpForInvite,
    null,
  );
  const next = `/invite/${token}`;
  return (
    <div className="stack">
      <form action={action} className="stack">
        <input type="hidden" name="token" value={token} />
        <div className="field">
          <label htmlFor="invite-email-shown">Email</label>
          <input id="invite-email-shown" value={email} readOnly aria-readonly="true" />
          <p className="hint">The invitation is for this address.</p>
        </div>
        <div className="field">
          <label htmlFor="invite-password">{mode === "sign-in" ? "Password" : "Choose a password"}</label>
          <input
            id="invite-password"
            name="password"
            type="password"
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            minLength={mode === "sign-up" ? 10 : undefined}
            required
            autoFocus
          />
          {mode === "sign-up" && <p className="hint">At least 10 characters.</p>}
        </div>
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
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Please wait…" : mode === "sign-in" ? "Sign in and accept" : "Create account"}
        </button>
        <button
          type="button"
          className="link-button"
          onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
        >
          {mode === "sign-in" ? "No account yet? Create one" : "Have an account? Sign in"}
        </button>
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
