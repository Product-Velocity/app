"use client";

import { useActionState, useState } from "react";
import { SelectField } from "@/components/search-list";
import { DATE_FORMATS, LANGUAGES, type Profile } from "@/lib/account";
import { changeEmail, changePassword, chooseNotificationEmail, removeLinkedEmail, saveGithubUsername, saveProfile, startLinkEmail, verifyLinkEmail, type FormState } from "./actions";

const Message = ({ state }: { state: FormState }) => (
  <>
    {state?.ok && <p role="status" className="success">{state.ok}</p>}
    {state?.error && <p role="alert" className="error">{state.error}</p>}
  </>
);

export function ProfileForm({ profile, zones }: { profile: Profile; zones: string[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveProfile, null);
  const [language, setLanguage] = useState(profile.language);
  const [timeZone, setTimeZone] = useState(profile.timeZone);
  const [dateFormat, setDateFormat] = useState(profile.dateFormat);
  return (
    <form action={action} className="stack">
      <label>Name<input name="full_name" defaultValue={profile.fullName} maxLength={120} autoComplete="name" /></label>
      <div className="row-form">
        <label>Language<SelectField label="Language" value={language} onChange={setLanguage} options={[...LANGUAGES]} /></label>
        <label>Time zone<SelectField label="Time zone" value={timeZone} onChange={setTimeZone} options={zones.map((z) => ({ value: z, label: z }))} /></label>
        <label>Date format<SelectField label="Date format" value={dateFormat} onChange={setDateFormat} options={[...DATE_FORMATS]} /></label>
      </div>
      <input type="hidden" name="language" value={language} />
      <input type="hidden" name="time_zone" value={timeZone} />
      <input type="hidden" name="date_format" value={dateFormat} />
      <div><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Save profile"}</button></div>
      <Message state={state} />
    </form>
  );
}

export function EmailForm({ email, hasPassword }: { email: string; hasPassword: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(changeEmail, null);
  return (
    <form action={action} className="stack">
      <p className="muted">Your email is <strong>{email}</strong>. We send a link to the new address and the change happens when you open it.</p>
      <label>New email<input name="email" type="email" required autoComplete="email" /></label>
      {hasPassword && <label>Current password<input name="current_password" type="password" required autoComplete="current-password" /></label>}
      {!hasPassword && <p className="muted">You sign in with Google or GitHub, so there is no password to ask for. This works within 15 minutes of signing in.</p>}
      <div><button className="btn" type="submit" disabled={pending}>{pending ? "Sending…" : "Change email"}</button></div>
      <Message state={state} />
    </form>
  );
}

export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(changePassword, null);
  return (
    <form action={action} className="stack">
      {hasPassword && <label>Current password<input name="current_password" type="password" required autoComplete="current-password" /></label>}
      <label>{hasPassword ? "New password" : "Set a password"}<input name="new_password" type="password" required minLength={10} autoComplete="new-password" /></label>
      <p className="muted">At least 10 characters, mixing letters with digits or symbols, and not a common password.</p>
      <div><button className="btn" type="submit" disabled={pending}>{pending ? "Saving…" : hasPassword ? "Change password" : "Set password"}</button></div>
      <Message state={state} />
    </form>
  );
}

export function GithubUsernameForm({ current, workspace }: { current: string; workspace: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveGithubUsername, null);
  return (
    <form action={action} className="stack">
      <label>GitHub username in {workspace}<input name="github_username" defaultValue={current} maxLength={40} autoComplete="off" spellCheck={false} placeholder="for example ana-gh" /></label>
      <p className="hint">Used to match you with the people assigned on GitHub issues. Anyone in this workspace can see it. Leave it empty to stop matching.</p>
      <Message state={state} />
      <button className="btn" type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
    </form>
  );
}

export type LinkedEmail = { email: string; is_sign_in: boolean; verified: boolean; use_for_notifications: boolean };

/** R-111 FR-4: more addresses on one identity. Add, verify with a code, choose where notifications go, remove. */
export function LinkedEmails({ emails }: { emails: LinkedEmail[] }) {
  const [start, startAction, starting] = useActionState<FormState, FormData>(startLinkEmail, null);
  const [verify, verifyAction, verifying] = useActionState<FormState, FormData>(verifyLinkEmail, null);
  const pending = emails.filter((e) => !e.verified && !e.is_sign_in);
  return (
    <div className="stack">
      <p className="muted">
        One person, one sign-in, several addresses. You can sign in with any verified address. An address on a company&rsquo;s authorized domain
        asks that company&rsquo;s admins to let you in. An address can belong to one person only.
      </p>
      <ul className="plain-list" data-testid="linked-emails">
        {emails.map((e) => (
          <li key={e.email} className="row-form">
            <strong>{e.email}</strong>
            {e.is_sign_in && <span className="muted">Sign-in address</span>}
            {!e.is_sign_in && <span className="muted">{e.verified ? "Verified" : "Not verified yet"}</span>}
            {e.verified && e.use_for_notifications && <span className="muted">· Notifications go here</span>}
            {e.verified && !e.use_for_notifications && (
              <form action={chooseNotificationEmail}><input type="hidden" name="email" value={e.is_sign_in ? "" : e.email} /><button className="btn" type="submit">Use for notifications</button></form>
            )}
            {!e.is_sign_in && (
              <form action={removeLinkedEmail}><input type="hidden" name="email" value={e.email} /><button className="btn" type="submit" aria-label={`Remove ${e.email}`}>Remove</button></form>
            )}
          </li>
        ))}
      </ul>
      <form action={startAction} className="row-form">
        <label>Add an address<input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
        <button className="btn" type="submit" disabled={starting}>{starting ? "Sending…" : "Send code"}</button>
      </form>
      <Message state={start} />
      {(pending.length > 0 || start?.ok) && (
        <form action={verifyAction} className="row-form">
          <label>Address
            <select name="email" defaultValue={pending[0]?.email}>
              {pending.map((e) => <option key={e.email} value={e.email}>{e.email}</option>)}
            </select>
          </label>
          <label>6-digit code<input name="code" inputMode="numeric" pattern="[0-9 ]{6,7}" required maxLength={7} autoComplete="one-time-code" /></label>
          <button className="btn btn-primary" type="submit" disabled={verifying}>{verifying ? "Checking…" : "Verify"}</button>
        </form>
      )}
      <Message state={verify} />
    </div>
  );
}
