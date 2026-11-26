"use client";

import { useState } from "react";

/** A plain form POST to /auth/callback; the button shows progress while the browser waits for the sign-in and the next page. */
export function ConfirmForm({ tokenHash, type, next }: { tokenHash: string; type: string; next: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <form method="post" action="/auth/callback" className="stack" onSubmit={() => setBusy(true)}>
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="next" value={next} />
      <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy}>
        {busy ? "Signing you in…" : "Continue"}
      </button>
      {busy && (
        <p role="status" className="hint">
          This can take a few seconds. Please do not close this page.
        </p>
      )}
    </form>
  );
}
