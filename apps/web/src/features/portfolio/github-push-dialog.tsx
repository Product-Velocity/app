"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { checkGithubBoard, confirmGithubSync, startGithubSync } from "@/app/(workspace)/portfolio/github-push";
import { applyBoardLines, boardCandidates, chunk, CHECK_CHUNK, failedCard, mergeChecked } from "./sync-progress";
import type { PlanItem, PushItemResult, ReceiveItem, ReceiveStatus, SyncChoice, SyncConflict, SyncPreview, TakenOver } from "@/lib/github/push-types";

type Props = { ids: string[]; onClose: () => void; onDone?: () => void; /** Texts taken over from GitHub (already saved): the grid shows them and makes them one undo step. */ onTakenOver?: (changes: TakenOver[]) => void };
type Phase = { kind: "loading" } | ({ kind: "preview" } & SyncPreview & { notice?: string }) | { kind: "sending" } | { kind: "done"; results: PushItemResult[] } | { kind: "error"; message: string };

const WILL: Record<PlanItem["action"], (p: PlanItem) => string> = {
  create: (p) => `Will create a new issue in ${p.repo}`,
  update: (p) => `Will update issue #${p.issueNumber} in ${p.repo}`,
  unchanged: () => "Already up to date: nothing to send",
  blocked: (p) => `Cannot send: ${p.reason}`,
};
const STATUS: Record<ReceiveStatus, string> = { in_step: "In step", received: "Received", conflict: "Conflict to settle", not_on_github: "Not on GitHub", follows: "In step", missing: "Issue not found", error: "Could not check" };
const DID: Record<PushItemResult["outcome"], string> = { created: "Created", updated: "Updated", unchanged: "No change", missing: "Not sent", error: "Failed", blocked: "Not sent" };

const keyOf = (itemId: string, field: string) => `${itemId}:${field}`;
const defaults = (received: ReceiveItem[]): Record<string, "pv" | "github"> => {
  const out: Record<string, "pv" | "github"> = {};
  for (const r of received) for (const c of r.conflicts ?? []) if (c.defaultChoice) out[keyOf(r.id, c.field)] = c.defaultChoice;
  return out;
};
const SHORT = 280;
function Text({ text }: { text: string }) {
  if (text.length <= SHORT) return <pre className="push-body">{text || "(empty)"}</pre>;
  return <><pre className="push-body">{text.slice(0, SHORT)}…</pre><details><summary>Show full text</summary><pre className="push-body">{text}</pre></details></>;
}
const WHY: Record<SyncConflict["kind"], (label: string, where?: "board") => string> = {
  github: (l, w) => `${l} was changed ${w ? "on the GitHub Project board" : "in GitHub"}. Product Velocity owns it, so nothing is overwritten until you choose.`,
  both: (l, w) => `${l} was changed in Product Velocity and ${w ? "on the GitHub Project board" : "in GitHub"}. Choose which one to keep.`,
  block: () => "The managed block was edited in GitHub and cannot be read field by field.",
};

/**
 * Sync with GitHub: checks GitHub first (and applies what GitHub owns), then shows exactly what would be written to GitHub and waits
 * for the person to confirm. Nothing is sent before that. With nothing to send it still shows what the check found, and offers Done.
 */
export function GithubPushDialog({ ids, onClose, onDone, onTakenOver }: Props) {
  const titleId = useId();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [choices, setChoices] = useState<Record<string, "pv" | "github">>({});

  const [progress, setProgress] = useState<{ done: number; total: number } | null>({ done: 0, total: ids.length });
  const [retrying, setRetrying] = useState<string | null>(null);

  // the check runs in chunks of a few initiatives, so cards appear as they are ready (up to 25); the board is read once at the end
  useEffect(() => {
    let live = true;
    (async () => {
      let state = { received: [] as ReceiveItem[], send: [] as PlanItem[] };
      let account = "";
      setProgress({ done: 0, total: ids.length });
      for (const part of chunk(ids, CHECK_CHUNK)) {
        const r = await startGithubSync(part, { board: false }).catch(() => null);
        if (!live) return;
        if (r && !r.ok) { setPhase({ kind: "error", message: r.error }); setProgress(null); return; }
        const fresh = r ? { received: r.received, send: r.send } : { received: part.map(failedCard), send: [] };
        if (r) account = r.account;
        state = mergeChecked(ids, state, fresh);
        setChoices((prev) => ({ ...defaults(state.received), ...prev }));
        setPhase({ kind: "preview", ...state, account });
        setProgress({ done: state.received.length, total: ids.length });
      }
      const linked = boardCandidates(state.received);
      if (linked.length > 0) {
        const b = await checkGithubBoard(linked).catch(() => null);
        if (!live) return;
        if (b && b.ok) { state = { ...state, received: applyBoardLines(state.received, b.lines, b.failed) }; setPhase({ kind: "preview", ...state, account }); }
      }
      setProgress(null);
    })();
    return () => { live = false; };
  }, [ids]);

  /** Checks one initiative again after its card said it could not be checked. */
  const retry = async (id: string) => {
    setRetrying(id);
    const r = await startGithubSync([id], { board: false }).catch(() => null);
    setRetrying(null);
    if (!r || !r.ok) return;
    setPhase((p) => (p.kind === "preview" ? { ...p, ...mergeChecked(ids, p, { received: r.received, send: r.send }) } : p));
    setChoices((prev) => ({ ...defaults(r.received), ...prev }));
  };
  useEffect(() => { confirmRef.current?.focus(); }, [phase.kind]);

  const preview = phase.kind === "preview" ? phase : null;
  const conflicts = preview ? preview.received.flatMap((r) => (r.conflicts ?? []).map((c) => ({ r, c }))) : [];
  const unchosen = conflicts.filter(({ r, c }) => !choices[keyOf(r.id, c.field)]);
  // what a confirm will write to GitHub: the plan's sends, plus every initiative where Product Velocity's text was chosen over GitHub's
  const sendIds = new Set(preview ? preview.send.filter((p) => p.action === "create" || p.action === "update").map((p) => p.id) : []);
  for (const { r, c } of conflicts) if (choices[keyOf(r.id, c.field)] === "pv") sendIds.add(r.id);
  for (const { r, c } of conflicts) if (c.field === "block" && choices[keyOf(r.id, c.field)] === "github" && !conflicts.some((x) => x.r.id === r.id && x.c.field !== "block" && choices[keyOf(r.id, x.c.field)] === "pv")) sendIds.delete(r.id);
  const overwrites = conflicts.filter(({ r, c }) => choices[keyOf(r.id, c.field)] === "pv").length;
  // only initiatives with something to apply or send go to the confirm, which checks GitHub again for exactly those
  const actionIds = preview ? ids.filter((id) => sendIds.has(id) || conflicts.some((x) => x.r.id === id)) : [];
  const needsConfirm = actionIds.length > 0;
  const checking = progress !== null;

  // "Keep GitHub for all" skips the values that cannot be taken over from the board: those stay Keep Product Velocity
  const choose = (all: "pv" | "github") => setChoices(Object.fromEntries(conflicts.map(({ r, c }) => [keyOf(r.id, c.field), c.githubPullable === false ? "pv" : all])));
  const send = async () => {
    if (!preview) return;
    const picks: SyncChoice[] = conflicts.map(({ r, c }) => ({ itemId: r.id, field: c.field, choice: choices[keyOf(r.id, c.field)]!, ghHash: c.ghHash }));
    setPhase({ kind: "sending" });
    try {
      const r = await confirmGithubSync(actionIds, picks);
      if (r.ok) {
        setPhase({ kind: "done", results: r.results });
        // the grid knows the G2M date by its dictionary key, not by its column
        if (r.taken.length > 0) onTakenOver?.(r.taken.map((t) => (t.field === "end_date" ? { ...t, field: "g2m_date_est" as never } : t)));
        router.refresh();
        onDone?.();
      } else if (r.stale) {
        setChoices(defaults(r.stale.received));
        setPhase({ kind: "preview", ...r.stale, notice: r.error });
      } else {
        setPhase({ kind: "error", message: r.error });
      }
    } catch {
      setPhase({ kind: "error", message: "Sending did not finish. Check GitHub before trying again: an issue may already have been created, and pushing again will find it." });
    }
  };

  return (
    <div className="dialog-backdrop" onKeyDown={(e) => { if (e.key === "Escape" && phase.kind !== "sending") { e.stopPropagation(); onClose(); } }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{phase.kind === "done" ? "Synced with GitHub" : "Sync with GitHub"}</h2>

        {phase.kind === "loading" && <p role="status">Checking GitHub… {progress ? `${progress.done} of ${progress.total}` : ""}</p>}
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
              {phase.notice && <strong role="alert" className="error">{phase.notice} </strong>}
              Product Velocity checked <strong>{phase.account}</strong> on GitHub. What GitHub owns (state, progress, epics and tasks, board Status) is already applied and listed under Received. Nothing is written to GitHub until you confirm. If you send, only the name, summary, description, hypothesis, artifact links, links to files you chose to share (private repositories only), a few labels, a milestone, the fields of the linked GitHub Project board and a link back go out; value, confidence,
              customers, decisions and other commercial fields never leave the app. The repository may be public.
            </p>
            {conflicts.length > 1 && (
              <div className="dialog-actions" role="group" aria-label="Settle all conflicts at once">
                <button type="button" className="btn" onClick={() => choose("pv")}>Keep Product Velocity for all conflicts</button>
                <button type="button" className="btn" onClick={() => choose("github")}>Keep GitHub for all conflicts</button>
              </div>
            )}
            {progress && <p role="status" aria-live="polite" className="muted">Checked {progress.done} of {progress.total}…</p>}
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
                    {r.status === "error" && !checking && <> <button type="button" className="btn" disabled={retrying === r.id} onClick={() => retry(r.id)}>{retrying === r.id ? "Checking…" : "Try again"}</button></>}
                    {r.readOnly && <><br /><span className="muted">Follows this issue read-only: nothing to send.</span></>}
                    {(r.status === "in_step" || r.status === "follows") && !sends && <><br /><span className="muted">Everything is in step.</span></>}
                    {r.received.length > 0 && (
                      <>
                        <br /><strong>Received from GitHub</strong> (already applied)
                        {r.received.map((l) => <span key={l.label} className="muted" style={{ display: "block" }}>{l.label}: {l.from ?? "empty"} → {l.to ?? "empty"}</span>)}
                      </>
                    )}
                    {(r.conflicts ?? []).map((c) => {
                      const name = `choice-${r.id}-${c.field}`;
                      const value = choices[keyOf(r.id, c.field)];
                      return (
                        <fieldset key={c.field} className="push-conflict">
                          <legend><strong>Conflict · {c.label}</strong></legend>
                          <p className="muted">{WHY[c.kind](c.label, c.where)}{c.note ? ` ${c.note}` : ""}</p>
                          {c.kind !== "block" && (
                            <div className="push-sides">
                              <div><strong>Product Velocity</strong><Text text={c.pv} /></div>
                              <div><strong>GitHub</strong><Text text={c.github} /></div>
                            </div>
                          )}
                          {c.kind === "block" && <p className="muted">{c.github}</p>}
                          <label><input type="radio" name={name} checked={value === "pv"} onChange={() => setChoices({ ...choices, [keyOf(r.id, c.field)]: "pv" })} /> Keep Product Velocity{c.defaultChoice === "pv" ? " (default)" : ""}</label>{" "}
                          <label><input type="radio" name={name} checked={value === "github"} disabled={c.githubPullable === false} onChange={() => setChoices({ ...choices, [keyOf(r.id, c.field)]: "github" })} /> Keep GitHub{c.githubPullable === false ? " (not possible)" : c.defaultChoice === "github" ? " (default)" : ""}</label>
                        </fieldset>
                      );
                    })}
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
            {overwrites > 0 && <p role="note" className="muted">Keep Product Velocity replaces the text in GitHub with Product Velocity’s when you press Apply and send. Anything outside the marked block stays.</p>}
            {unchosen.length > 0 && <p role="status" className="muted">Choose for {unchosen.length === 1 ? "the conflict above" : `all ${unchosen.length} open conflicts`} to continue.</p>}
            <div className="dialog-actions">
              {needsConfirm && <button type="button" className="btn" onClick={onClose}>Cancel</button>}
              <button ref={confirmRef} type="button" className="btn btn-primary" disabled={unchosen.length > 0 || checking} onClick={needsConfirm ? send : onClose}>
                {checking ? "Checking…" : !needsConfirm ? "Done" : sendIds.size > 0 ? "Apply and send" : "Apply"}
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
