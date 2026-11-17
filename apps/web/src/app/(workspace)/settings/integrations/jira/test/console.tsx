"use client";

import { useState, useTransition } from "react";
import { reportText, summarize, type CheckKind, type CheckResult } from "@/lib/atlassian/jira-checks";
import { runJiraReadChecks, runJiraWriteCheck, type CheckRun } from "./actions";

export type SavedRun = { kind: CheckKind; runAt: string; checks: CheckResult[] };
const WORD = { pass: "PASS", warn: "WARN", fail: "FAIL" } as const;

function Results({ run, title }: { run: SavedRun; title: string }) {
  const [copied, setCopied] = useState(false);
  const s = summarize(run.checks);
  const when = new Date(run.runAt).toLocaleString();
  const copy = async () => { try { await navigator.clipboard.writeText(reportText(run.kind, run.checks, when)); setCopied(true); } catch { setCopied(false); } };
  return (
    <section className="stack" aria-label={title}>
      <h3>{title}</h3>
      <p className="muted">{when} · {s.pass} pass · {s.warn} warn · {s.fail} fail <button type="button" className="btn" onClick={copy}>{copied ? "Copied" : "Copy the report"}</button></p>
      <table className="table">
        <caption className="visually-hidden">{title}</caption>
        <thead><tr><th scope="col">Check</th><th scope="col">Result</th><th scope="col">Why, and what to do</th></tr></thead>
        <tbody>{run.checks.map((c) => (
          <tr key={c.key}><td>{c.label}</td><td><strong>{WORD[c.status]}</strong></td><td>{c.reason}{c.fix ? <><br /><em>What to do:</em> {c.fix}</> : null}</td></tr>
        ))}</tbody>
      </table>
    </section>
  );
}

export function CheckConsole({ connections, projectKeys, last }: { connections: { id: string; sites: { id: string; name: string }[] }[]; projectKeys: string[]; last: { read: SavedRun | null; write: SavedRun | null } }) {
  const [read, setRead] = useState<SavedRun | null>(last.read);
  const [write, setWrite] = useState<SavedRun | null>(last.write);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, start] = useTransition();
  const options = connections.flatMap((c) => c.sites.map((s) => ({ value: `${c.id}|${s.id}`, label: s.name })));
  const [target, setTarget] = useState(options[0]?.value ?? "");
  const submit = (action: (f: FormData) => Promise<CheckRun>, form: HTMLFormElement) => {
    const f = new FormData(form);
    const [connection, site] = target.split("|");
    f.set("connection", connection ?? ""); f.set("site", site ?? "");
    start(async () => {
      const r = await action(f);
      if ("error" in r) { setError(r.error); return; }
      setError(null);
      (r.kind === "read" ? setRead : setWrite)({ kind: r.kind, runAt: r.runAt, checks: r.checks });
      if (r.kind === "write") setConfirm(false);
    });
  };
  return (
    <div className="stack">
      {options.length > 1 && (
        <label>Jira site <select value={target} onChange={(e) => setTarget(e.target.value)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
      )}
      {error && <p role="alert" className="error">{error}</p>}
      <form className="card stack" onSubmit={(e) => { e.preventDefault(); submit(runJiraReadChecks, e.currentTarget); }}>
        <h2>Initiative-level checks</h2>
        <p className="muted">Reads only. Checks that Jira has a level above Epic, finds an Initiative and reads its children the way Product Velocity does, and warns about same-named types and epics in projects without live updates.</p>
        <label>Initiative key (optional) <input name="initiative" placeholder="ROAD-12" pattern="[A-Za-z][A-Za-z0-9_]{1,19}-[0-9]{1,9}" size={12} /></label>
        <div><button className="btn btn-primary" disabled={busy || !target}>{busy ? "Checking…" : "Run the read-only checks"}</button></div>
        {read ? <Results run={read} title="Last read-only run" /> : <p className="muted">Not run yet.</p>}
      </form>
      <form className="card stack" onSubmit={(e) => { e.preventDefault(); submit(runJiraWriteCheck, e.currentTarget); }}>
        <h2>Write test</h2>
        <p className="muted">Proves that an epic in one project can take an Initiative from another as its parent, and that the children query sees it. It <strong>creates and deletes 2 test issues</strong> in Jira (label pv-spike) and always removes them again; it asks Jira&rsquo;s search again every 2 seconds for up to 10 seconds, because the search lags behind a write.</p>
        <datalist id="jira-project-keys">{projectKeys.map((k) => <option key={k} value={k} />)}</datalist>
        <div className="row-form">
          <label>Initiative project key <input name="initiativeProject" list="jira-project-keys" placeholder="ROAD" pattern="[A-Za-z][A-Za-z0-9_]{1,19}" required size={10} /></label>
          <label>Epic project key <input name="epicProject" list="jira-project-keys" placeholder="R8P" pattern="[A-Za-z][A-Za-z0-9_]{1,19}" required size={10} /></label>
        </div>
        <label><input type="checkbox" name="confirm" value="yes" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I understand this creates and deletes 2 test issues in Jira.</label>
        <div><button className="btn" disabled={busy || !confirm || !target}>{busy ? "Running…" : "Run the write test"}</button></div>
        {write ? <Results run={write} title="Last write test" /> : <p className="muted">Not run yet.</p>}
      </form>
    </div>
  );
}
