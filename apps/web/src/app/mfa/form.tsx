"use client";

import { useActionState } from "react";
import { verifyMfa, type MfaState } from "./actions";

export function MfaForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<MfaState, FormData>(verifyMfa, null);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="next" value={next} />
      <div className="field">
        <label htmlFor="code">Authentication code</label>
        <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" required autoFocus />
      </div>
      {state?.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Checking…" : "Verify"}
      </button>
    </form>
  );
}
