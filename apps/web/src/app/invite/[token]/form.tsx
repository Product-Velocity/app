"use client";

import { useActionState } from "react";
import { acceptInvitation, type AcceptState } from "./actions";

export function AcceptForm({ token }: { token: string }) {
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
        {pending ? "Joining…" : "Accept invitation"}
      </button>
    </form>
  );
}
