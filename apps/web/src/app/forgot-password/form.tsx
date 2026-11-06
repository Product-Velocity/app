"use client";

import { useActionState, useState } from "react";
import { LinkSent } from "@/components/link-sent";
import type { LinkState } from "@/app/sign-in/actions";
import { requestPasswordReset } from "./actions";

export function ForgotForm({ initialEmail }: { initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [state, action, pending] = useActionState<LinkState, FormData>(requestPasswordReset, null);
  const [dismissed, setDismissed] = useState(false);

  if (state?.sent && !dismissed) {
    return (
      <LinkSent
        key={state.nonce}
        email={state.email}
        lifetime="60 minutes"
        resendAction={action}
        resendFields={<input type="hidden" name="email" value={state.email} />}
        pending={pending}
        onBack={() => setDismissed(true)}
        backLabel="Use a different email"
      />
    );
  }

  return (
    <form
      className="stack"
      action={(fd) => {
        setDismissed(false);
        action(fd);
      }}
    >
      <div>
        <h1>Forgot your password?</h1>
        <p className="sub">Enter your email and we will send a link to choose a new one.</p>
      </div>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />
      </div>
      {state?.error && !state.sent && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </button>
      <a className="link-button" href="/sign-in">
        Back to sign in
      </a>
    </form>
  );
}
