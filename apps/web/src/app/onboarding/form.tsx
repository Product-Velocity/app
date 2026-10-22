"use client";

import { useActionState } from "react";
import { createTenant, type OnboardingState } from "./actions";

export function CreateTenantForm() {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(createTenant, null);
  return (
    <form action={action} className="stack">
      <div className="field">
        <label htmlFor="name">Workspace name</label>
        <input id="name" name="name" maxLength={120} required autoFocus placeholder="Your company or team" />
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
