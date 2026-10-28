"use client";

import { useActionState } from "react";
import { createTenant, type OnboardingState } from "./actions";

export function CreateTenantForm({ suggestedDomain, countries, currencies, timeZones }: { suggestedDomain: string; countries: string[]; currencies: string[]; timeZones: string[] }) {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(createTenant, null);
  return (
    <form action={action} className="stack">
      <div className="field">
        <label htmlFor="name">Workspace name</label>
        <input id="name" name="name" maxLength={120} required autoFocus placeholder="Your company or team" />
      </div>
      <div className="field">
        <label htmlFor="country">Country</label>
        <input id="country" name="country" list="country-list" maxLength={80} autoComplete="country-name" />
        <datalist id="country-list">{countries.map((c) => <option key={c} value={c} />)}</datalist>
      </div>
      <div className="field">
        <label htmlFor="currency">Currency</label>
        <input id="currency" name="currency" list="currency-list" maxLength={3} placeholder="EUR" style={{ textTransform: "uppercase" }} />
        <datalist id="currency-list">{currencies.map((c) => <option key={c} value={c} />)}</datalist>
      </div>
      <div className="field">
        <label htmlFor="time_zone">Time zone</label>
        <input id="time_zone" name="time_zone" list="tz-list" maxLength={64} placeholder="Europe/Madrid" defaultValue={typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : ""} />
        <datalist id="tz-list">{timeZones.map((z) => <option key={z} value={z} />)}</datalist>
      </div>
      <div className="field">
        <label htmlFor="domains">Authorized email domains</label>
        <input id="domains" name="domains" defaultValue={suggestedDomain} placeholder="yourcompany.com" aria-describedby="domains-help" required={suggestedDomain !== ""} />
        <p id="domains-help" className="hint">
          People who sign up with an address at one of these domains can ask to join. They get no access until you approve them.
          Separate several with commas. Free email providers such as gmail.com are not accepted.
          {suggestedDomain === "" && " You signed up with a personal address, so you can leave this empty and add a company domain later."}
        </p>
      </div>
      {state?.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create workspace"}
      </button>
    </form>
  );
}
