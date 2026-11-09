"use client";

import { useCallback, useEffect, useState } from "react";
import { createPasskeyClient, passkeyErrorText, passkeysSupported } from "@/lib/supabase/passkey";

type Passkey = { id: string; friendly_name?: string | null; created_at: string; last_used_at?: string | null };
const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** The person's passkeys: add one (this device or a security key), rename, remove. Uses the signed-in session. */
export function Passkeys() {
  const [client] = useState(() => (typeof window === "undefined" ? null : createPasskeyClient()));
  const [supported, setSupported] = useState<boolean | null>(null);
  const [list, setList] = useState<Passkey[] | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!client) return;
    const { data, error } = await client.auth.passkey.list();
    if (error) { setMessage({ kind: "error", text: passkeyErrorText(error as { code?: string }) }); setList([]); return; }
    setList((data ?? []) as Passkey[]);
  }, [client]);
  // the browser can only be asked after the first render
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => { const s = passkeysSupported(); setSupported(s); if (s) void load(); }, [load]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const add = async () => {
    if (!client) return;
    setBusy(true); setMessage(null);
    const { error } = await client.auth.registerPasskey();
    setBusy(false);
    if (error) { setMessage({ kind: "error", text: passkeyErrorText(error as { code?: string; name?: string }) }); return; }
    setMessage({ kind: "ok", text: "Passkey added." });
    await load();
  };
  const rename = async (p: Passkey) => {
    const name = window.prompt("Name for this passkey", p.friendly_name ?? "");
    if (!client || !name?.trim()) return;
    const { error } = await client.auth.passkey.update({ passkeyId: p.id, friendlyName: name.trim().slice(0, 120) });
    if (error) setMessage({ kind: "error", text: "The name could not be changed." }); else await load();
  };
  const remove = async (p: Passkey) => {
    if (!client || !window.confirm(`Remove the passkey "${p.friendly_name ?? "Passkey"}"? You can still sign in another way.`)) return;
    const { error } = await client.auth.passkey.delete({ passkeyId: p.id });
    if (error) setMessage({ kind: "error", text: "The passkey could not be removed." }); else { setMessage({ kind: "ok", text: "Passkey removed." }); await load(); }
  };

  if (supported === false) return <p className="muted">This browser cannot use passkeys.</p>;
  return (
    <div className="stack">
      <p className="muted">Sign in with your face, fingerprint, PIN or a security key instead of a password. A passkey stays on your device or in your password manager.</p>
      {list && list.length > 0 && (
        <ul className="plain-list" aria-label="Your passkeys">
          {list.map((p) => (
            <li key={p.id}>
              <strong>{p.friendly_name ?? "Passkey"}</strong> <span className="muted">added {when(p.created_at)}{p.last_used_at ? `, last used ${when(p.last_used_at)}` : ""}</span>{" "}
              <button type="button" className="btn btn-link" onClick={() => rename(p)}>Rename</button>{" "}
              <button type="button" className="btn btn-link" onClick={() => remove(p)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div><button type="button" className="btn btn-primary" disabled={busy || supported === null} onClick={add}>{busy ? "Waiting for your passkey…" : "Add a passkey"}</button></div>
      {message && <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "error" : "success"}>{message.text}</p>}
    </div>
  );
}
