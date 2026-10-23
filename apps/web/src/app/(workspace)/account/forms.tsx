"use client";

import { useActionState, useState } from "react";
import { SelectField } from "@/components/search-list";
import { DATE_FORMATS, LANGUAGES, type Profile } from "@/lib/account";
import { changeEmail, changePassword, saveProfile, type FormState } from "./actions";

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
