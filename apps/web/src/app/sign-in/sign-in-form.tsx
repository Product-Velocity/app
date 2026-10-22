"use client";

import { useActionState, useState } from "react";
import { signInWithPassword, signUp, type AuthState } from "./actions";

export function PasswordForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [state, action, pending] = useActionState<AuthState, FormData>(
    mode === "sign-in" ? signInWithPassword : signUp,
    null,
  );

  return (
    <form action={action} className="stack">
      <input type="hidden" name="next" value={next} />
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          minLength={mode === "sign-up" ? 10 : undefined}
          required
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
        {pending ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Create account"}
      </button>
      <button
        type="button"
        className="link-button"
        onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
      >
        {mode === "sign-in" ? "New here? Create an account" : "Have an account? Sign in"}
      </button>
    </form>
  );
}
