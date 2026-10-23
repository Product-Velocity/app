"use client";
import { useActionState, useState, useTransition } from "react";
import { probe, runCheck, type SpikeOutput } from "./actions";
import { CHECKS, reportMarkdown, type CheckResult } from "@/lib/spikes/checks-shared";

const LABEL: Record<CheckResult["verdict"], string> = { pass: "PASS", fail: "FAIL", info: "INFO", manual: "MANUAL STEP" };

export function SpikeConsole() {
  const [results, setResults] = useState<CheckResult[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, start] = useTransition();
  const [probeOut, probeAction] = useActionState(async (prev: SpikeOutput | null, form: FormData) => {
    try {
      return await probe(prev, form);
    } catch (e) {
      return { title: "Probe failed", steps: [{ label: "error", result: { error: e instanceof Error ? e.message : String(e) } }] };
    }
  }, null);

  const runAll = () =>
    start(async () => {
      setResults([]);
      setCopied(false);
      for (const c of CHECKS) {
        setRunning(c.title);
        try {
          const r = await runCheck(c.id);
          setResults((prev) => [...prev, r]);
        } catch (e) {
          setResults((prev) => [...prev, { id: c.id, title: c.title, verdict: "fail", summary: e instanceof Error ? e.message : String(e) }]);
        }
      }
      setRunning(null);
    });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reportMarkdown(results));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const count = (v: CheckResult["verdict"]) => results.filter((r) => r.verdict === v).length;

  return (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "16px 0" }}>
        <button disabled={busy} onClick={runAll}>{busy ? "Running…" : "Run all checks"}</button>
        <button disabled={results.length === 0} onClick={copy}>{copied ? "Copied" : "Copy report"}</button>
        {running && <span role="status">Running: {running}</span>}
        {!busy && results.length > 0 && (
          <span>{count("pass")} pass · {count("fail")} fail · {count("info")} info · {count("manual")} manual</span>
        )}
      </div>
      <ol style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {results.map((r) => (
          <li key={r.id} style={{ border: "1px solid #ccd", borderRadius: 6, padding: 10 }}>
            <strong>{LABEL[r.verdict]}</strong> · {r.title}
            <p style={{ margin: "4px 0" }}>{r.summary}</p>
            {r.fix && <p style={{ margin: "4px 0" }}><strong>How to fix:</strong> {r.fix}</p>}
            {r.evidence !== undefined && (
              <details>
                <summary>Evidence</summary>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{JSON.stringify(r.evidence, null, 1)}</pre>
              </details>
            )}
          </li>
        ))}
      </ol>
      <details style={{ marginTop: 24 }}>
        <summary>Manual probe (advanced)</summary>
        <form action={probeAction} style={{ display: "grid", gap: 6, margin: "8px 0" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <select name="method" defaultValue="GET" aria-label="Method"><option>GET</option><option>POST</option><option>PATCH</option><option>PUT</option></select>
            <select name="auth" defaultValue="installation" aria-label="Token"><option value="installation">installation token</option><option value="app">App JWT</option></select>
            <input name="path" required placeholder="/graphql" style={{ flex: "1 1 360px", minWidth: 240 }} aria-label="API path" />
          </div>
          <textarea name="body" rows={4} placeholder="JSON body (optional)" aria-label="JSON body" />
          <button type="submit">Send</button>
        </form>
        {probeOut && <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{JSON.stringify(probeOut.steps, null, 1)}</pre>}
      </details>
    </>
  );
}
