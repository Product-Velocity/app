"use client";

import { useActionState } from "react";
import { finishOnboarding, type AboutState } from "./actions";
import { GOAL_OPTIONS, ROLE_OPTIONS } from "@/lib/onboarding";

export function AboutForm({ defaultFirst, defaultLast, flow = "owner" }: { defaultFirst: string; defaultLast: string; flow?: "owner" | "invited" }) {
  const [state, action, pending] = useActionState<AboutState, FormData>(finishOnboarding, null);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="flow" value={flow} />
      <div className="name-row">
        <div className="field">
          <label htmlFor="first_name">First name</label>
          <input id="first_name" name="first_name" maxLength={60} autoComplete="given-name" autoFocus required defaultValue={defaultFirst} />
        </div>
        <div className="field">
          <label htmlFor="last_name">Last name <span className="muted">(optional)</span></label>
          <input id="last_name" name="last_name" maxLength={60} autoComplete="family-name" defaultValue={defaultLast} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="role">Your role <span className="muted">(optional)</span></label>
        <select id="role" name="role" defaultValue="">
          <option value="">Choose…</option>
          {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      {flow === "owner" && (
      <div className="field">
        <label htmlFor="goal">What do you want to fix first? <span className="muted">(optional)</span></label>
        <select id="goal" name="goal" defaultValue="">
          <option value="">Choose…</option>
          {GOAL_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>
      )}
      {state?.error && <p role="alert" className="error">{state.error}</p>}
      <div className="wizard-actions">
        <button className="btn btn-primary" type="submit" name="intent" value="save" disabled={pending}>{pending ? "Saving…" : flow === "invited" ? "Open the roadmap" : "Finish and open my roadmap"}</button>
        <button className="btn" type="submit" name="intent" value="skip" disabled={pending} formNoValidate>Skip for now</button>
      </div>
    </form>
  );
}
