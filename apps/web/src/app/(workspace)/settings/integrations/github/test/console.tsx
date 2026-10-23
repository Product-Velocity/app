"use client";

import { useState, useTransition } from "react";
import { reportMarkdown, type CheckResult } from "@pv/github";
import { runConnectionTest } from "../actions";

const LABEL = { pass: "PASS", fail: "FAIL", info: "INFO" } as const;

export function TestConsole() {
  const [results, setResults] = useState<CheckResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, start] = useTransition();

  const run = () =>
    start(async () => {
      setCopied(false);
      const r = await runConnectionTest();
      if ("error" in r) { setError(r.error); setResults(null); } else { setError(null); setResults(r.results); }
    });
  const copy = async () => {
    if (!results) return;
    try { await navigator.clipboard.writeText(reportMarkdown("GitHub connection test", results)); setCopied(true); } catch { setCopied(false); }
  };
  const count = (v: CheckResult["verdict"]) => results?.filter((r) => r.verdict === v).length ?? 0;

  return (
    <div className="stack">
      <div className="row-form">
        <button className="btn btn-primary" onClick={run} disabled={busy}>{busy ? "Testing…" : "Run test"}</button>
        <button className="btn" onClick={copy} disabled={!results}>{copied ? "Copied" : "Copy report"}</button>
        {results && !busy && <span>{count("pass")} pass · {count("fail")} fail · {count("info")} info</span>}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      <ol className="stack" style={{ listStyle: "none", padding: 0 }}>
        {results?.map((r) => (
          <li key={r.id} className="card">
            <strong>{LABEL[r.verdict]}</strong> · {r.title}
            <p>{r.summary}</p>
            {r.fix && <p><strong>How to fix:</strong> {r.fix}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
