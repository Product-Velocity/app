"use client";

import { useEffect, useState } from "react";
import { createPasskeyClient, passkeyErrorText, forgetPasskeyHere, hasPasskeyHere, passkeysSupported, recordPasskeyError, rememberPasskeyHere, passkeyDiagnostics, withPlatformPasskeys } from "@/lib/supabase/passkey";

/** "Sign in with a passkey": face, fingerprint, PIN or a security key. Shown only where the browser supports it and a passkey was added or used on this device. */
export function PasskeySignIn({ next }: { next: string }) {
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  // the browser can only be asked after the first render
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setSupported(passkeysSupported() && hasPasskeyHere()); }, []);
  if (!supported) return null;

  const go = async () => {
    setBusy(true); setError(null);
    const { error: e } = await withPlatformPasskeys(() => createPasskeyClient().auth.signInWithPasskey());
    if (e) { if ((e as { code?: string }).code === "webauthn_credential_not_found") forgetPasskeyHere(); recordPasskeyError(e as { code?: string; name?: string }); setDetails(passkeyDiagnostics()); setError(passkeyErrorText(e as { code?: string; message?: string; name?: string })); setBusy(false); return; }
    rememberPasskeyHere();
    // a full load, so the server reads the new session (and asks for the two-factor code when that is on)
    window.location.assign(next);
  };

  return (
    <div className="stack">
      <button type="button" className="btn" disabled={busy} onClick={go}>{busy ? "Waiting for your passkey…" : "Sign in with a passkey"}</button>
      {error && <p role="alert" className="error">{error}</p>}
      {details && <details><summary>Technical details</summary><pre className="mono" style={{ whiteSpace: "pre-wrap" }}>{details}</pre></details>}
    </div>
  );
}
