"use client";

import { useActionState, useState } from "react";
import { canSubmitNewPassword, NewPasswordFields, PasswordField } from "@/components/password-field";
import { signInWithPassword, signUp, type AuthState } from "./actions";

/**
 * `mode` comes from the page URL so sign-in and create-account are separate
 * page loads: password managers decide whether to offer a generated password
 * when the page loads, not after a client-side switch.
 */
export function PasswordForm({ next, mode }: { next: string; mode: "sign-in" | "sign-up" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, action, pending] = useActionState<AuthState, FormData>(
    mode === "sign-in" ? signInWithPassword : signUp,
    null,
  );

  const canSubmit = mode === "sign-in" ? password.length > 0 : canSubmitNewPassword(password, confirm, email);
  const otherHref = `/sign-in?${mode === "sign-in" ? "mode=sign-up&" : ""}next=${encodeURIComponent(next)}`;

  return (
    <form action={action} className="stack">
      <input type="hidden" name="next" value={next} />
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      {mode === "sign-in" ? (
        <PasswordField
          name="password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
      ) : (
        <NewPasswordFields
          password={password}
          confirm={confirm}
          onPassword={setPassword}
          onConfirm={setConfirm}
          email={email}
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
        {pending ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Create account"}
      </button>
      {/* plain link on purpose: a full page load gives password managers a fresh, correct form */}
      <a className="link-button" href={otherHref}>
        {mode === "sign-in" ? "New here? Create an account" : "Have an account? Sign in"}
      </a>
    </form>
  );
}
