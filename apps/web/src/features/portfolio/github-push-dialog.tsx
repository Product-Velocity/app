"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { confirmGithubPush, startGithubSync } from "@/app/(workspace)/portfolio/github-push";
import type { PlanItem, PushItemResult, ReceiveItem, ReceiveStatus } from "@/lib/github/push-types";

type Props = { ids: string[]; onClose: () => void; onDone?: () => void };
type Phase = { kind: "loading" } | { kind: "preview"; received: ReceiveItem[]; send: PlanItem[]; account: string } | { kind: "sending" } | { kind: "done"; results: PushItemResult[] } | { kind: "error"; message: string };

const WILL: Record<PlanItem["action"], (p: PlanItem) => string> = {
  create: (p) => `Will create a new issue in ${p.repo}`,
  update: (p) => `Will update issue #${p.issueNumber} in ${p.repo}`,
  unchanged: () => "Already up to date: nothing to send",
  blocked: (p) => `Cannot send: ${p.reason}`,
};
const STATUS: Record<ReceiveStatus, string> = { in_step: "In step", received: "Received", not_on_github: "Not on GitHub", follows: "In step", missing: "Issue not found", error: "Could not check" };
const DID: Record<PushItemResult["outcome"], string> = { created: "Created", updated: "Updated", unchanged: "No change", missing: "Not sent", error: "Failed", blocked: "Not sent" };

/**
 * Sync with GitHub: checks GitHub first (and applies what GitHub owns), then shows exactly what would be written to GitHub and waits
 * for the person to confirm. Nothing is sent before that. With nothing to send it still shows what the check found, and offers Done.
 */
export function GithubPushDialog({ ids, onClose, onDone }: Props) {
  const titleId = useId();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let live = true;
    startGithubSync(ids).then(
      (r) => live && setPhase(r.ok ? { kind: "preview", received: r.received, send: r.send, account: r.account } : { kind: "error", message: r.error }),
      () => live && setPhase({ kind: "error", message: "We could not check GitHub. Try again." }),
    );
    return () => { live = false; };
  }, [ids]);
  useEffect(() => { confirmRef.current?.focus(); }, [phase.kind]);

  const sendable = phase.kind === "preview" ? phase.send.filter((p) => p.action === "create" || p.action === "update") : [];
  const send = async () => {
    setPhase({ kind: "sending" });
    try {
      const r = await confirmGithubPush(sendable.map((p) => p.id));
      setPhase(r.ok ? { kind: "done", results: r.results } : { kind: "error", message: r.error });
      if (r.ok) { router.refresh(); onDone?.(); }
    } catch {
      setPhase({ kind: "error", message: "Sending did not finish. Check GitHub before trying again: an issue may already have been created, and pushing again will find it." });
    }
  };

  return (
    <div className="dialog-backdrop" onKeyDown={(e) => { if (e.key === "Escape" && phase.kind !== "sending") { e.stopPropagation(); onClose(); } }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{phase.kind === "done" ? "Synced with GitHub" : "Sync with GitHub"}</h2>

        {phase.kind === "loading" && <p role="status">Checking GitHub…</p>}
        {phase.kind === "sending" && <p role="status">Sending to GitHub… keep this window open.</p>}
        {phase.kind === "error" && (
          <>
            <p role="alert" className="error">{phase.message}</p>
            <div className="dialog-actions"><button ref={confirmRef} type="button" className="btn" onClick={onClose}>Close</button></div>
          </>
        )}

        {phase.kind === "preview" && (
          <>
            <p>
              Product Velocity checked <strong>{phase.account}</strong> on GitHub. What GitHub owns (state, progress, epics and tasks, board Status) is already applied and listed under Received. Nothing is written to GitHub until you confirm. If you send, only the name, summary, description, hypothesis, artifact links, links to files you chose to share (private repositories only), a few labels, a milestone, the fields of the linked GitHub Project board and a link back go out; value, confidence,
              customers, decisions and other commercial fields never leave the app. The repository may be public.
            </p>
            <ul className="push-list">
              {phase.received.map((r) => {
                const p = r.readOnly ? undefined : phase.send.find((x) => x.id === r.id);
                const sends = p?.action === "create" || p?.action === "update";
                const label = sends && r.status !== "received" && r.status !== "error" && r.status !== "missing" ? "To send" : STATUS[r.status];
                return (
                  <li key={r.id} className={r.status === "error" || r.status === "missing" || p?.action === "blocked" ? "push-blocked" : undefined}>
                    <strong>{r.code}</strong> {r.name} · <span className="push-pill">{label}</span>
                    {r.issueNumber && r.issueUrl && <> · <a href={r.issueUrl} target="_blank" rel="noreferrer">issue #{r.issueNumber}</a></>}
                    {r.message && <><br /><span className="muted">{r.message}</span></>}
                    {r.readOnly && <><br /><span className="muted">Follows this issue read-only: nothing to send.</span></>}
                    {(r.status === "in_step" || r.status === "follows") && !sends && <><br /><span className="muted">Everything is in step.</span></>}
                    {r.received.length > 0 && (
                      <>
                        <br /><strong>Received from GitHub</strong> (already applied)
                        {r.received.map((l) => <span key={l.label} className="muted" style={{ display: "block" }}>{l.label}: {l.from ?? "empty"} → {l.to ?? "empty"}</span>)}
                      </>
                    )}
                    {p && (
                      <>
                        <br /><span className="muted">{WILL[p.action](p)}</span>
                        {sends && (
                          <details>
                            <summary>See what will be written</summary>
                            <p><strong>Title:</strong> {p.title}</p>
                            <p><strong>Labels:</strong> {p.labels.join(", ")}</p>
                            {p.milestone && <p><strong>Milestone:</strong> {p.milestone}</p>}
                            {p.board && (
                              <p>
                                <strong>Project board “{p.board.title}”:</strong>{" "}
                                {p.board.included ? (p.board.writes.length ? p.board.writes.map((w) => `${w.field} ${w.value}`).join(", ") : "added, no fields to set") : "not added"}
                                {p.board.included && p.board.children > 0 && ` Also adds ${p.board.children} child issue${p.board.children === 1 ? "" : "s"} (epics and tasks) to the board.`}
                                {p.board.notes.map((n) => <span key={n} className="muted"> {n}</span>)}
                              </p>
                            )}
                            {p.filesNote && <p role="note" className="muted">{p.filesNote}</p>}
                            <p className="muted">Labels starting with “pv:” are managed here: new ones are added and ones that no longer apply are removed. Any other label is never touched.</p>
                            <pre className="push-body">{p.block}</pre>
                          </details>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="muted">Text you or engineers write in the issue outside the marked block is kept. The marked block is overwritten the next time you send.</p>
            <div className="dialog-actions">
              {sendable.length > 0 && <button type="button" className="btn" onClick={onClose}>Cancel</button>}
              <button ref={confirmRef} type="button" className="btn btn-primary" onClick={sendable.length === 0 ? onClose : send}>
                {sendable.length === 0 ? "Done" : `Send ${sendable.length} to GitHub`}
              </button>
            </div>
          </>
        )}

        {phase.kind === "done" && (
          <>
            <ul className="push-list">
              {phase.results.map((r) => (
                <li key={r.id} className={r.outcome === "error" || r.outcome === "missing" || r.outcome === "blocked" ? "push-blocked" : undefined}>
                  <strong>{r.code}</strong> · {DID[r.outcome]}
                  {r.issueUrl && <> · <a href={r.issueUrl} target="_blank" rel="noreferrer">issue #{r.issueNumber}</a></>}
                  {r.message && <><br /><span className="muted">{r.message}</span></>}
                </li>
              ))}
            </ul>
            <div className="dialog-actions"><button ref={confirmRef} type="button" className="btn btn-primary" onClick={onClose}>Close</button></div>
          </>
        )}
      </div>
    </div>
  );
}
