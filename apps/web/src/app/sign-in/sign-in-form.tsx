"use client";

import { useActionState, useState } from "react";
import { canSubmitNewPassword, NewPasswordFields, PasswordField } from "@/components/password-field";
import { LinkSent } from "@/components/link-sent";
import { sendSignInLink, signInWithPassword, signUp, type AuthState, type LinkState } from "./actions";

/**
 * `mode` comes from the page URL so sign-in and create-account are separate
 * page loads: password managers decide whether to offer a generated password
 * when the page loads, not after a client-side switch.
 */
export function PasswordForm({ next, mode }: { next: string; mode: "sign-in" | "sign-up" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, action, pending] = useActionState<AuthState, FormData>(
    mode === "sign-in" ? signInWithPassword : signUp,
    null,
  );

  const [linkState, linkAction, linkPending] = useActionState<LinkState, FormData>(sendSignInLink, null);
  const [dismissed, setDismissed] = useState(false);

  const canSubmit = mode === "sign-in" ? password.length > 0 : canSubmitNewPassword(password, email);
  const otherHref = `/sign-in?${mode === "sign-in" ? "mode=sign-up&" : ""}next=${encodeURIComponent(next)}`;

  const sent = mode === "sign-in" && linkState?.sent && !dismissed ? linkState : null;
  if (sent) {
    return (
      <LinkSent
        key={sent.nonce}
        email={sent.email}
        lifetime="60 minutes"
        resendAction={linkAction}
        resendFields={
          <>
            <input type="hidden" name="email" value={sent.email} />
            <input type="hidden" name="next" value={next} />
          </>
        }
        pending={linkPending}
        onBack={() => setDismissed(true)}
        backLabel="Use a different email or sign in with a password"
      />
    );
  }

  return (
    <form action={action} className="stack">
      <input type="hidden" name="next" value={next} />
      <div className="field">
        <label htmlFor="email">{mode === "sign-in" ? "Email" : "Work email"}</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      {mode === "sign-in" ? (
        <>
        <PasswordField
          name="password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        <a className="link-button forgot" href={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ""}`}>
          Forgot password?
        </a>
        </>
      ) : (
        <NewPasswordFields
          password={password}
          onPassword={setPassword}
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
      {mode === "sign-in" && (
        <>
          <button
            className="btn"
            type="submit"
            formNoValidate
            disabled={linkPending}
            formAction={(fd) => {
              setDismissed(false);
              linkAction(fd);
            }}
          >
            {linkPending ? "Sending link…" : "Email me a sign-in link"}
          </button>
          {linkState?.error && !linkState.sent && (
            <p role="alert" className="error">
              {linkState.error}
            </p>
          )}
        </>
      )}
      {mode === "sign-up" && <p className="hint">We email you a link to confirm your address.</p>}
      {/* plain link on purpose: a full page load gives password managers a fresh, correct form */}
      <a className="link-button" href={otherHref}>
        {mode === "sign-in" ? "New here? Create an account" : "Have an account? Sign in"}
      </a>
    </form>
  );
}
