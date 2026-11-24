"use client";

import { useActionState } from "react";
import { finishOnboarding, type AboutState } from "./actions";
import { GOAL_OPTIONS, ROLE_OPTIONS } from "@/lib/onboarding";

export function AboutForm({ defaultName, flow = "owner" }: { defaultName: string; flow?: "owner" | "invited" }) {
  const [state, action, pending] = useActionState<AboutState, FormData>(finishOnboarding, null);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="flow" value={flow} />
      <div className="field">
        <label htmlFor="full_name">Your name <span className="muted">(optional)</span></label>
        <input id="full_name" name="full_name" maxLength={120} autoComplete="name" autoFocus defaultValue={defaultName} placeholder="So your team knows who you are" />
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
