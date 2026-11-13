"use client";

import { useActionState } from "react";
import { saveWorkspace, type WorkspaceState } from "./actions";

export type WorkspaceValues = { name: string; country: string; currency: string; timeZone: string; domains: string; restrictInvites: boolean; companyUrl: string };

export function WorkspaceForm({ values, countries, currencies, timeZones, canEdit }: { values: WorkspaceValues; countries: string[]; currencies: string[]; timeZones: string[]; canEdit: boolean }) {
  const [state, action, pending] = useActionState<WorkspaceState, FormData>(saveWorkspace, null);
  return (
    <form action={action} className="stack">
      <div className="field">
        <label htmlFor="ws-name">Organization name</label>
        <input id="ws-name" name="name" defaultValue={values.name} maxLength={120} required disabled={!canEdit} />
      </div>
      <div className="field">
        <label htmlFor="ws-company-url">Company website</label>
        <input id="ws-company-url" name="company_url" inputMode="url" defaultValue={values.companyUrl} maxLength={300} placeholder="yourcompany.com" disabled={!canEdit} aria-describedby="ws-company-url-help" />
        <p id="ws-company-url-help" className="hint">Optional. Claude reads it to learn what your company does; the result is a draft you confirm under Company profile. Separate from the authorized email domains.</p>
      </div>
      <div className="field">
        <label htmlFor="ws-country">Country</label>
        <input id="ws-country" name="country" list="ws-country-list" defaultValue={values.country} maxLength={80} disabled={!canEdit} />
        <datalist id="ws-country-list">{countries.map((c) => <option key={c} value={c} />)}</datalist>
      </div>
      <div className="field">
        <label htmlFor="ws-currency">Currency</label>
        <input id="ws-currency" name="currency" list="ws-currency-list" defaultValue={values.currency} maxLength={3} style={{ textTransform: "uppercase" }} disabled={!canEdit} />
        <datalist id="ws-currency-list">{currencies.map((c) => <option key={c} value={c} />)}</datalist>
      </div>
      <div className="field">
        <label htmlFor="ws-tz">Time zone</label>
        <input id="ws-tz" name="time_zone" list="ws-tz-list" defaultValue={values.timeZone} maxLength={64} disabled={!canEdit} />
        <datalist id="ws-tz-list">{timeZones.map((z) => <option key={z} value={z} />)}</datalist>
      </div>
      <div className="field">
        <label htmlFor="ws-domains">Authorized email domains</label>
        <textarea id="ws-domains" name="domains" defaultValue={values.domains} rows={2} aria-describedby="ws-domains-help" disabled={!canEdit} />
        <p id="ws-domains-help" className="hint">
          Someone who signs up with a confirmed address at one of these domains appears in Members as Requested Access, your admins are
          emailed, and they get no access until you approve them. Domains are not verified by DNS yet, so only list domains you own.
          Separate several with commas. Free email providers are not accepted.
        </p>
      </div>
      <div className="field">
        <label className="check">
          <input type="checkbox" name="restrict_invites" defaultChecked={values.restrictInvites} disabled={!canEdit} aria-describedby="ws-restrict-help" />
          {" "}Restrict invites to authorized domains
        </label>
        <p id="ws-restrict-help" className="hint">
          Off by default. Off: you can invite anyone, for example a consultant who works with several companies. On: invitations to addresses
          outside the domains above are refused.
        </p>
      </div>
      {state?.error && <p role="alert" className="error">{state.error}</p>}
      {state?.saved && <p role="status" className="notice">Saved.</p>}
      {canEdit && <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Save settings"}</button>}
    </form>
  );
}
