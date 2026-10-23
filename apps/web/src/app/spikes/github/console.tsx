"use client";
import { useActionState, useState, useTransition } from "react";
import { checkConnection, probe, runS2b, runS4b, webhookDeliveries, type SpikeOutput } from "./actions";

export function SpikeConsole() {
  const [out, setOut] = useState<SpikeOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [, probeAction] = useActionState(async (prev: SpikeOutput | null, form: FormData) => {
    try {
      const r = await probe(prev, form);
      setOut(r);
      setError(null);
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return prev;
    }
  }, null);

  const run = (fn: () => Promise<SpikeOutput>) =>
    start(async () => {
      try {
        setOut(await fn());
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "16px 0" }}>
        <button disabled={busy} onClick={() => run(checkConnection)}>1. Check connection</button>
        <button disabled={busy} onClick={() => run(runS4b)}>2. S4b sub-issues</button>
        <button disabled={busy} onClick={() => run(runS2b)}>3. S2b Spike Project</button>
        <button disabled={busy} onClick={() => run(webhookDeliveries)}>4. Webhook deliveries</button>
      </div>
      <form action={probeAction} style={{ display: "grid", gap: 6, marginBottom: 16 }}>
        <strong>Probe (S3b issue fields and anything else)</strong>
        <div style={{ display: "flex", gap: 6 }}>
          <select name="method" defaultValue="GET"><option>GET</option><option>POST</option><option>PATCH</option><option>PUT</option></select>
          <select name="auth" defaultValue="installation"><option value="installation">installation token</option><option value="app">App JWT</option></select>
          <input name="path" required placeholder="/orgs/Product-Velocity/issue-fields" style={{ flex: 1 }} aria-label="API path" />
        </div>
        <textarea name="body" rows={4} placeholder="JSON body (optional)" aria-label="JSON body" />
        <button type="submit">Send</button>
      </form>
      {busy && <p>Working…</p>}
      {error && <p role="alert">Error: {error}</p>}
      {out && (
        <section>
          <h2>{out.title}</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{JSON.stringify(out.steps, null, 2)}</pre>
        </section>
      )}
    </>
  );
}
