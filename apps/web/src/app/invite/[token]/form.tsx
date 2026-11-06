"use client";

import { useActionState, useState } from "react";
import { canSubmitNewPassword, NewPasswordFields, PasswordField } from "@/components/password-field";
import { AuthProviders } from "@/components/auth-providers";
import { LinkSent } from "@/components/link-sent";
import { acceptInvitation, sendInviteSignInLink, signInAndAccept, signUpForInvite, type AcceptState, type LinkState } from "./actions";

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
  const [state, action, pending] = useActionState<AcceptState, FormData>(
    mode === "sign-in" ? signInAndAccept : signUpForInvite,
    null,
  );
  const [linkState, linkAction, linkPending] = useActionState<LinkState, FormData>(sendInviteSignInLink, null);
  const [dismissed, setDismissed] = useState(false);
  const next = `/invite/${token}`;
  const canSubmit = mode === "sign-in" ? password.length > 0 : canSubmitNewPassword(password, email);
  if (linkState?.sent && !dismissed) {
    return (
      <LinkSent
        key={linkState.nonce}
        email={linkState.email}
        lifetime="15 minutes"
        resendAction={linkAction}
        resendFields={<input type="hidden" name="token" value={token} />}
        pending={linkPending}
        onBack={() => setDismissed(true)}
        backLabel="Use a password instead"
      />
    );
  }
  return (
    <div className="stack">
      <AuthProviders next={next} hint="With Google or GitHub, use the account that has the email address below." />
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
          <>
          <PasswordField
            name="password"
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            autoFocus
          />
          <a className="link-button forgot" href={`/forgot-password?email=${encodeURIComponent(email)}`}>
            Forgot password?
          </a>
          </>
        ) : (
          <NewPasswordFields
            password={password}
            onPassword={setPassword}
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
          {pending ? "Please wait…" : mode === "sign-in" ? "Sign in and join" : "Create account and join"}
        </button>
        {mode === "sign-in" && (
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
        )}
        {linkState?.error && !linkState.sent && (
          <p role="alert" className="error">
            {linkState.error}
          </p>
        )}
        {/* plain links on purpose: a full page load gives password managers a fresh, correct form */}
        <a className="link-button" href={mode === "sign-in" ? "?mode=create" : "?mode=sign-in"}>
          {mode === "sign-in" ? "No account yet? Create one" : "Already have an account? Sign in"}
        </a>
      </form>

    </div>
  );
}
