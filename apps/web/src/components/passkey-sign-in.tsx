"use client";

import { useEffect, useState } from "react";
import { createPasskeyClient, passkeyErrorText, passkeysSupported } from "@/lib/supabase/passkey";

/** "Sign in with a passkey": face, fingerprint, PIN or a security key. Shown only where the browser supports it. */
export function PasskeySignIn({ next }: { next: string }) {
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the browser can only be asked after the first render
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setSupported(passkeysSupported()); }, []);
  if (!supported) return null;

  const go = async () => {
    setBusy(true); setError(null);
    const { error: e } = await createPasskeyClient().auth.signInWithPasskey();
    if (e) { setError(passkeyErrorText(e as { code?: string; message?: string; name?: string })); setBusy(false); return; }
    // a full load, so the server reads the new session (and asks for the two-factor code when that is on)
    window.location.assign(next);
  };

  return (
    <div className="stack">
      <button type="button" className="btn" disabled={busy} onClick={go}>{busy ? "Waiting for your passkey…" : "Sign in with a passkey"}</button>
      {error && <p role="alert" className="error">{error}</p>}
    </div>
  );
}
