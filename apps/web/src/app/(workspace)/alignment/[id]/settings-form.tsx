"use client";

import { useActionState, useState } from "react";
import { METHODS, groupsToText, type Group } from "@/lib/alignment";
import { saveSettings, type FormState } from "../actions";

type Session = { id: string; name: string; method: string; groups: Group[]; weighting: string; excluded: string[]; coinsTotal: number; coinsMax: number; showResults: boolean; retention: number; closesAt: string | null };

const local = (iso: string | null) => (iso ? new Date(iso).toLocaleString("sv-SE", { hour12: false }).replace(" ", "T").slice(0, 16) : "");

/** Draft settings. Everything is read-only once the session has opened. The closing time is typed in the person's own time zone. */
export function SettingsForm({ session, locked }: { session: Session; locked: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveSettings, null);
  const [method, setMethod] = useState(session.method);
  const [groupsText, setGroupsText] = useState(groupsToText(session.groups));
  const names = groupsText.split(/\r?\n/).map((g) => g.trim()).filter(Boolean);
  const slug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "group";
  return (
    <form
      action={(f) => {
        const raw = String(f.get("closes_at") ?? "");
        f.set("closes_at_iso", raw ? new Date(raw).toISOString() : "");
        action(f);
      }}
      className="stack"
    >
      <input type="hidden" name="id" value={session.id} />
      <fieldset disabled={locked} className="stack">
        <label>Name<input name="name" defaultValue={session.name} maxLength={120} required /></label>
        <label>Method
          <select name="method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
        <p className="muted">{METHODS.find((m) => m.value === method)?.help}</p>
        {method === "coins" && (
          <div className="row-form">
            <label>Coins per person<input name="coins_total" type="number" min={10} max={1000} defaultValue={session.coinsTotal} /></label>
            <label>Most on one initiative<input name="coins_max" type="number" min={1} max={1000} defaultValue={session.coinsMax} /></label>
          </div>
        )}
        {method !== "coins" && <><input type="hidden" name="coins_total" value={session.coinsTotal} /><input type="hidden" name="coins_max" value={session.coinsMax} /></>}
        <label>Groups (one per line: role, region, customer type…)
          <textarea name="groups" rows={4} value={groupsText} onChange={(e) => setGroupsText(e.target.value)} />
        </label>
        <p className="muted">A group with fewer than 5 voters is merged into &ldquo;Other&rdquo; and shown only when that has 5 or more.</p>
        <label>Weighting of groups in the joint score
          <select name="weighting" defaultValue={session.weighting}>
            <option value="equal">Equal: every group counts the same</option>
            <option value="headcount">By headcount: bigger groups count more</option>
          </select>
        </label>
        {names.length > 1 && (
          <fieldset className="stack">
            <legend>Leave out of the joint score</legend>
            {names.map((n) => <label key={n} className="check"><input type="checkbox" name="excluded" value={slug(n)} defaultChecked={session.excluded.includes(slug(n))} /> {n}</label>)}
          </fieldset>
        )}
        <label>Closes at (optional, your time zone)<input name="closes_at" type="datetime-local" defaultValue={local(session.closesAt)} /></label>
        <label className="check"><input type="checkbox" name="show_results" defaultChecked={session.showResults} /> Participants may see the anonymous results after the session closes</label>
        <label>Keep personal data for (months after closing)<input name="retention" type="number" min={1} max={120} defaultValue={session.retention} /></label>
      </fieldset>
      {!locked && <div><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Save settings"}</button></div>}
      {state?.ok && <p role="status" className="success">{state.ok}</p>}
      {state?.error && <p role="alert" className="error">{state.error}</p>}
    </form>
  );
}
