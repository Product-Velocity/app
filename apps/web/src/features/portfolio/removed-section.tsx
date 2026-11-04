"use client";

import { useEffect, useId, useState } from "react";
import type { RemovedApi, RemovedCard, RemovedResult } from "@/lib/github/push-types";

// "Removed in Product Velocity" in the Sync with Jira and Sync with GitHub dialogs (decisions 2026-11-03-jira-close-removed and 2026-11-03-github-close-removed):
// initiatives in the Trash whose issue Product Velocity owns. Each one says what will happen; nothing is written until the person presses the button, which
// labels and closes the issues one at a time ("Writing x/y"), with a result and Try again per initiative. One component for both trackers, same words.

export type RemovedTracker = "github" | "jira";
const NAME: Record<RemovedTracker, string> = { github: "GitHub", jira: "Jira" };
const DID = (name: string): Record<RemovedResult["outcome"], string> => ({ closed: "Closed", labeled: "Labelled only", already_done: "Already done, labelled", not_found: `Not found in ${name}`, error: "Not closed" });
const lost = (name: string) => `Closing did not finish for this initiative. Check ${name} before trying again: the issue may already be labelled or closed, and trying again will find it.`;
const trackerOf = (c: RemovedCard): RemovedTracker => c.tracker ?? "jira";

/** The words for what pressing the button does to one card. */
export function willText(c: RemovedCard, chosen: string | null): string {
  if (trackerOf(c) === "github") {
    if (c.alreadyDone) return `Already closed${c.trackerStatus ? ` (${c.trackerStatus})` : ""}: will only add the label pv:removed.`;
    return "Will add the label pv:removed and close the issue as “not planned”.";
  }
  if (c.alreadyDone) return `Already in a Done status${c.jiraStatus ? ` (${c.jiraStatus})` : ""}: will only add the label pv:removed.`;
  if (c.options.length === 0) return "Jira shows no way to move this issue to a Done status: will only add the label pv:removed. Close it in Jira.";
  const to = c.options.find((o) => o.id === chosen)?.toStatusName;
  if (c.options.length === 1 || to) return `Will add the label pv:removed and move the issue to “${to ?? c.options[0]!.toStatusName}”.`;
  return "Choose which Done status to move the issue to.";
}

export function RemovedSection({ api, tracker = "jira", onBusy, onCount }: { api: RemovedApi; tracker?: RemovedTracker; onBusy?: (busy: boolean) => void; /** How many removed initiatives are listed (for the Deletions filter). */ onCount?: (n: number) => void }) {
  const headId = useId();
  const name = NAME[tracker];
  const [items, setItems] = useState<RemovedCard[] | null>(null);
  const [more, setMore] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [pick, setPick] = useState<Record<string, string>>({});
  const [run, setRun] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<RemovedResult[]>([]);
  const [retrying, setRetrying] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.list().then(
      (r) => {
        if (!live) return;
        if (!r.ok) { setFailed(r.error); setItems([]); return; }
        setItems(r.items);
        onCount?.(r.items.length + r.more);
        setMore(r.more);
        setOn(Object.fromEntries(r.items.filter((c) => c.state === "ready" && !c.adopted).map((c) => [c.id, true]))); // an adopted issue is never ticked for you
        setPick(Object.fromEntries(r.items.filter((c) => c.defaultTransitionId).map((c) => [c.id, c.defaultTransitionId!])));
      },
      () => { if (live) { setFailed("The removed initiatives could not be checked just now."); setItems([]); } },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  if (items === null) return <p role="status" className="muted">Checking removed initiatives…</p>;
  if (items.length === 0 && !failed) return null;

  // the transition sent for a card: the one chosen, else the only one; several with no choice cannot be confirmed
  const needsChoice = (c: RemovedCard) => c.state === "ready" && !c.alreadyDone && c.options.length > 1 && !pick[c.id];
  const selected = items.filter((c) => (c.state === "ready" || c.state === "gone") && on[c.id] && !results.some((r) => r.id === c.id && r.outcome !== "error"));
  const blocked = selected.filter(needsChoice).length;
  const transitionFor = (c: RemovedCard) => (c.alreadyDone || c.options.length === 0 ? null : (pick[c.id] ?? c.options[0]?.id ?? null));

  const closeOne = async (c: RemovedCard): Promise<RemovedResult> => {
    try {
      const r = await api.close(c.id, transitionFor(c));
      return r.ok ? r.result : { id: c.id, code: c.code, outcome: "error", message: r.error };
    } catch {
      return { id: c.id, code: c.code, outcome: "error", message: lost(name) };
    }
  };
  const press = async () => {
    const todo = selected;
    onBusy?.(true);
    setResults([]);
    setRun({ done: 0, total: todo.length });
    const out: RemovedResult[] = [];
    for (const c of todo) {
      out.push(await closeOne(c)); // one at a time; one failing never stops the others, and a refusal is shown, not retried
      setResults([...out]);
      setRun({ done: out.length, total: todo.length });
    }
    setRun(null);
    onBusy?.(false);
  };
  const again = async (c: RemovedCard) => {
    setRetrying(c.id);
    onBusy?.(true);
    const r = await closeOne(c);
    setResults((prev) => prev.map((x) => (x.id === c.id ? r : x)));
    setRetrying(null);
    onBusy?.(false);
  };
  const resultOf = (id: string) => results.find((r) => r.id === id);

  return (
    <section aria-labelledby={headId} className="push-removed">
      <h3 id={headId}>Removed in Product Velocity</h3>
      <p className="muted">
        {tracker === "github"
          ? <>These initiatives are in the Trash and Product Velocity owns their GitHub issue. If you confirm, Product Velocity adds the label “pv:removed” to the issue and closes it as “not planned” in GitHub. It never deletes an issue,
              never changes the initiative’s own status, and never touches an issue that is only followed from GitHub. Nothing is written until you press the button. Restoring an initiative later does not reopen its issue: reopen it in GitHub if the work comes back.</>
          : <>These initiatives are in the Trash and Product Velocity owns their Jira issue. If you confirm, Product Velocity adds the label “pv:removed” to the issue and moves it to a Done status in Jira. It never deletes an issue,
              never changes the initiative’s own status, and never touches an issue that came from Jira. Nothing is written until you press the button. Restoring an initiative later does not reopen its issue: reopen it in Jira if the work comes back.</>}
      </p>
      {failed && <p role="alert" className="error">{failed}</p>}
      <ul className="push-list">
        {items.map((c) => {
          const r = resultOf(c.id);
          return (
            <li key={c.id} className={c.state === "error" || r?.outcome === "error" ? "push-blocked" : undefined}>
              <label>
                <input type="checkbox" disabled={(c.state !== "ready" && c.state !== "gone") || !!run || (!!r && r.outcome !== "error")} checked={(c.state === "ready" || c.state === "gone") && !!on[c.id]} onChange={(e) => setOn({ ...on, [c.id]: e.target.checked })} />{" "}
                <strong>{c.code}</strong> {c.name}
              </label>
              {" · "}{c.issueUrl ? <a href={c.issueUrl} target="_blank" rel="noreferrer">issue {c.issueKey}</a> : <>issue {c.issueKey}</>}
              {(c.trackerStatus ?? c.jiraStatus) && <> · <span className="muted">{name} {tracker === "github" ? "state" : "status"}: {c.trackerStatus ?? c.jiraStatus}</span></>}
              <br />
              {c.adopted && <p role="note" className="error" style={{ margin: "6px 0" }}><strong>Warning: this issue was in {name} before Product Velocity took it over. Closing it ends real work there.</strong></p>}
              {c.state !== "ready" ? <span className="muted">{c.message}{c.state === "gone" && ` Tick it and press the button to mark it as handled: nothing is written to ${name}, and it is not offered again.`}</span> : (
                <>
                  <span className="muted">{willText(c, pick[c.id] ?? null)}</span>
                  {!c.alreadyDone && c.options.length > 1 && (
                    <> <label>Done status for {c.code}{" "}
                      <select value={pick[c.id] ?? ""} disabled={!!run} onChange={(e) => setPick({ ...pick, [c.id]: e.target.value })}>
                        <option value="" disabled>Choose…</option>
                        {c.options.map((o) => <option key={o.id} value={o.id}>{o.toStatusName} ({o.name})</option>)}
                      </select></label></>
                  )}
                </>
              )}
              {r && (
                <><br /><strong>{DID(name)[r.outcome]}</strong>{r.message && <> · <span className="muted">{r.message}</span></>}
                  {r.outcome === "error" && <> <button type="button" className="btn" disabled={retrying !== null || !!run} onClick={() => again(c)}>{retrying === c.id ? "Closing…" : "Try again"}</button></>}</>
              )}
            </li>
          );
        })}
      </ul>
      {more > 0 && <p className="muted">{more} more removed initiative{more === 1 ? "" : "s"} wait: they are offered next time you sync.</p>}
      {run ? (
        <p role="status" aria-live="polite"><strong>Writing {run.done}/{run.total}</strong> · keep this window open.</p>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
          <button type="button" className="btn" disabled={selected.length === 0 || blocked > 0} onClick={press}>
            {selected.length === 0 ? `Label and close in ${name}` : `Label and close ${selected.length} in ${name}`}
          </button>
          {blocked > 0 && <span role="status" className="muted">Choose a Done status for {blocked === 1 ? "the initiative above" : `${blocked} initiatives`} to continue.</span>}
        </div>
      )}
    </section>
  );
}
