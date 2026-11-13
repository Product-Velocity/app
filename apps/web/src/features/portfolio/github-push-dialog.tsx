"use client";

import { Loading, PillLoader } from "@/components/pill-loader";
import { useBusyTitle } from "@/lib/use-busy-title";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { checkBoard, confirmSync, startSync, syncTrackers } from "@/app/(workspace)/portfolio/sync";
import type { SyncApi } from "@/lib/tracker/sync-router";
import { RemovedSection } from "./removed-section";
import { wroteGithub } from "@/lib/sync-wrote";
import { closeRemovedInJira, listRemovedInJira } from "@/app/(workspace)/portfolio/jira-removed";
import { closeRemovedInGithub, listRemovedInGithub } from "@/app/(workspace)/portfolio/github-removed";
import { NewItemsStep, type NewItemsConfig } from "./new-items";
import { applyBoardLines, boardCandidates, chunk, CHECK_CHUNK, dropWritten, failedCard, filterBySend, hasIncoming, mergeChecked, replaceResults, writeAll, writingLabel, type UpdateFilter, type WrittenOne } from "./sync-progress";
import type { PlanItem, PushItemResult, ReceiveItem, ReceiveStatus, ReceivedLine, SyncChoice, SyncConflict, SyncPreview, TakenOver } from "@/lib/github/push-types";
import { StatusPill } from "../../components/status-pill";

/** The three server calls the dialog makes, routed to the sync engine of each initiative's tracker; a test page passes fakes. */
const REAL_API: SyncApi = { start: startSync, board: checkBoard, confirm: confirmSync, removed: { jira: { list: listRemovedInJira, close: closeRemovedInJira }, github: { list: listRemovedInGithub, close: closeRemovedInGithub } } };

type Props = { ids: string[]; api?: SyncApi; /** Given, the sync opens with the issues that are new in the tracker (when there are any): decide on them first. */ newItems?: NewItemsConfig | NewItemsConfig[]; /** Which trackers the initiatives belong to; decides which new-items steps show. The real thing asks the server. */ trackersOf?: (ids: string[]) => Promise<string[]>; onClose: () => void; onDone?: () => void; /** Texts taken over from GitHub (already saved): the grid shows them and makes them one undo step. */ onTakenOver?: (changes: TakenOver[]) => void };
/** What came in for one initiative and how its conflicts were settled, kept for the confirmed screen. */
type ItemDetail = { tracker: string; received: ReceivedLine[]; settled: { label: string; kept: "pv" | "tracker" }[] };
type Phase =
  | { kind: "loading" }
  /** `written`: what was already written before a stop (GitHub changed for one initiative), kept for the final list. */
  | ({ kind: "preview" } & SyncPreview & { notice?: string; written?: PushItemResult[] })
  | { kind: "writing"; done: number; total: number; results: PushItemResult[] }
  | { kind: "done"; results: PushItemResult[]; details: Record<string, ItemDetail> }
  | { kind: "error"; message: string };

const WILL: Record<PlanItem["action"], (p: PlanItem) => string> = {
  create: (p) => (p.tracker === "jira" ? `Will create a new issue in the Jira project ${p.repo}` : `Will create a new issue in ${p.repo}`),
  update: (p) => (p.tracker === "jira" ? `Will update issue ${p.issueLabel} in Jira` : `Will update issue #${p.issueNumber} in ${p.repo}`),
  unchanged: () => "Already up to date: nothing to send",
  blocked: (p) => `Cannot send: ${p.reason}`,
};
const STATUS: Record<ReceiveStatus, string> = { in_step: "In step", received: "Received", conflict: "Conflict to settle", not_on_github: "Not on GitHub", not_linked: "Not linked to Jira", follows: "In step", missing: "Issue not found", error: "Could not check" };
const DID: Record<PushItemResult["outcome"], string> = { created: "Created", updated: "Updated", unchanged: "No change", missing: "Not sent", error: "Failed", blocked: "Not sent" };

const keyOf = (itemId: string, field: string) => `${itemId}:${field}`;
const defaults = (received: ReceiveItem[]): Record<string, "pv" | "github"> => {
  const out: Record<string, "pv" | "github"> = {};
  for (const r of received) for (const c of r.conflicts ?? []) if (c.defaultChoice) out[keyOf(r.id, c.field)] = c.defaultChoice;
  return out;
};
const LOST = "Sending did not finish for this initiative. Check the tracker (GitHub or Jira) before trying again: an issue may already have been created, and sending again will find it.";
const SHORT = 280;
/** "Step 1 of 3": where the person is in the sync. The current step is marked for screen readers too. */
function Steps({ current, tracker }: { current: 1 | 2 | 3; tracker: string }) {
  const steps = [tracker ? `Incoming from ${tracker}` : "Incoming", tracker ? `Outgoing to ${tracker}` : "Outgoing", "Confirmed"];
  return (
    <ol className="push-steps" aria-label="Steps of the sync">
      {steps.map((t, i) => <li key={t} {...(current === i + 1 ? { "aria-current": "step" as const } : {})} className={current === i + 1 ? "push-step push-step-on" : "push-step"}>{i + 1}. {t}</li>)}
    </ol>
  );
}

/** Stage 3: for each initiative what came in, how conflicts were settled, and what was written to the tracker. */
function ConfirmedList({ results, details, onRetry, retrying }: { results: PushItemResult[]; details: Record<string, ItemDetail>; onRetry?: (id: string) => void; retrying?: string | null }) {
  const n = (o: PushItemResult["outcome"][]) => results.filter((r) => o.includes(r.outcome)).length;
  return (
    <>
      <p role="status"><strong>{n(["created", "updated"])} written</strong>{n(["unchanged"]) > 0 && <>, {n(["unchanged"])} already up to date</>}{n(["error", "missing", "blocked"]) > 0 && <>, <span className="error">{n(["error", "missing", "blocked"])} not written</span></>}.</p>
      <ul className="push-list" aria-label="Results">
        {results.map((r, i) => {
          const d = details[r.id];
          const tracker = d?.tracker === "jira" ? "Jira" : "GitHub";
          const problem = r.outcome === "error" || r.outcome === "missing" || r.outcome === "blocked";
          return (
            <li key={`${r.id}-${i}`} className={problem ? "push-blocked" : undefined} data-result={r.code}>
              <strong>{r.code}</strong> · {DID[r.outcome]}
              {r.issueUrl && <> · <a href={r.issueUrl} target="_blank" rel="noreferrer">{r.issueLabel ? `issue ${r.issueLabel}` : `issue #${r.issueNumber}`}</a></>}
              {r.message && <><br /><span className="muted">{r.message}</span></>}
              {onRetry && r.outcome === "error" && <> <button type="button" className="btn" disabled={retrying != null} onClick={() => onRetry(r.id)}>{retrying === r.id ? "Sending…" : "Try again"}</button></>}
              <span className="muted" style={{ display: "block" }}><strong>From {tracker} to Product Velocity:</strong>{" "}
                {d && d.received.length > 0 ? d.received.map((l) => `${l.label} ${l.from ?? "empty"} → ${l.to ?? "empty"}`).join("; ") : "nothing came in"}
                {d && d.settled.length > 0 && <> · conflicts settled: {d.settled.map((x) => `${x.label} (kept ${x.kept === "pv" ? "Product Velocity" : tracker})`).join(", ")}</>}
              </span>
              <span className="muted" style={{ display: "block" }}><strong>From Product Velocity to {tracker}:</strong>{" "}
                {r.wrote && r.wrote.length > 0 ? r.wrote.join(", ") : problem ? "nothing was written" : r.outcome === "unchanged" ? "nothing to write, already up to date" : "written"}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
/** The per-initiative results, shown while writing (the ones finished so far) and when done. A failed or unsent one can be tried again on its own. */
function ResultList({ results, onRetry, retrying }: { results: PushItemResult[]; onRetry?: (id: string) => void; retrying?: string | null }) {
  return (
    <ul className="push-list">
      {results.map((r, i) => (
        <li key={`${r.id}-${i}`} className={r.outcome === "error" || r.outcome === "missing" || r.outcome === "blocked" ? "push-blocked" : undefined}>
          <strong>{r.code}</strong> · {DID[r.outcome]}
          {r.issueUrl && <> · <a href={r.issueUrl} target="_blank" rel="noreferrer">{r.issueLabel ? `issue ${r.issueLabel}` : `issue #${r.issueNumber}`}</a></>}
          {r.message && <><br /><span className="muted">{r.message}</span></>}
          {onRetry && r.outcome === "error" && <> <button type="button" className="btn" disabled={retrying != null} onClick={() => onRetry(r.id)}>{retrying === r.id ? "Sending…" : "Try again"}</button></>}
        </li>
      ))}
    </ul>
  );
}
function Text({ text }: { text: string }) {
  if (text.length <= SHORT) return <pre className="push-body">{text || "(empty)"}</pre>;
  return <><pre className="push-body">{text.slice(0, SHORT)}…</pre><details><summary>Show full text</summary><pre className="push-body">{text}</pre></details></>;
}
const WHY: Record<SyncConflict["kind"], (label: string, where?: "board", tracker?: string) => string> = {
  github: (l, w, t = "GitHub") => `${l} was changed ${w ? "on the GitHub Project board" : `in ${t}`}. Product Velocity owns it, so nothing is overwritten until you choose.`,
  both: (l, w, t = "GitHub") => `${l} was changed in Product Velocity and ${w ? "on the GitHub Project board" : `in ${t}`}. Choose which one to keep.`,
  block: (_l, _w, t = "GitHub") => `The managed block was edited in ${t} and cannot be read field by field.`,
};

/**
 * Sync with GitHub: checks GitHub first (and applies what GitHub owns), then shows exactly what would be written to GitHub and waits
 * for the person to confirm. Nothing is sent before that. With nothing to send it still shows what the check found, and offers Done.
 */
export function GithubPushDialog({ ids, api = REAL_API, newItems, trackersOf = syncTrackers, onClose, onDone, onTakenOver }: Props) {
  const titleId = useId();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  // step 1 (new issues in the tracker) comes first when asked for; the check of the initiatives already runs underneath it
  const configs = useMemo(() => (newItems ? (Array.isArray(newItems) ? newItems : [newItems]) : []), [newItems]);
  const step = configs.some((c) => c.canEdit) ? "new" : "sync";
  // the new-items steps to show: one per tracker the selected initiatives belong to (null while that is being found out)
  const [queue, setQueue] = useState<NewItemsConfig[] | null>(null);
  const [trackerNames, setTrackerNames] = useState(""); // empty until the trackers are known: the window then says "Sync", not a guess
  // the tracker names are always looked up (the title, steps and "Checking…" text must say Jira for a Jira project, also when there is no new-issues step)
  useEffect(() => {
    const hasNew = configs.some((c) => c.canEdit);
    let live = true;
    trackersOf(ids).then(
      (ts) => { if (!live) return; if (hasNew) setQueue(configs.filter((c) => ts.includes(c.tracker) && c.canEdit)); setTrackerNames(ts.length ? ts.map((t) => (t === "jira" ? "Jira" : t === "gitlab" ? "GitLab" : "GitHub")).join(" and ") : "GitHub"); },
      () => { if (!live) return; setTrackerNames("GitHub"); if (hasNew) setQueue(configs.filter((c) => c.tracker === "github" && c.canEdit)); }, // cannot tell: behave as before (GitHub)
    );
    return () => { live = false; };
  }, [configs, ids, trackersOf]);
  const continueToSync = useCallback(() => setQueue((q) => (q ?? []).slice(1)), []);
  // keyboard focus goes into the window when it opens (a stable callback, so typing in the filters does not pull it back)
  const focusDialog = useCallback((el: HTMLDivElement | null) => { el?.focus(); }, []);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [choices, setChoices] = useState<Record<string, "pv" | "github">>({});
  const [updateFilter, setUpdateFilter] = useState<UpdateFilter | "deletions">("all");
  /** Stage 1 (incoming) comes first; stage 2 (outgoing) is where the person confirms. Stage 1 is skipped when nothing came in. */
  const [stage, setStage] = useState<"incoming" | "outgoing">("incoming");
  const [removedCounts, setRemovedCounts] = useState<Record<string, number>>({}); // initiatives in the Trash whose issue can be closed, per tracker (the Deletions filter)
  const removedCount = Object.values(removedCounts).reduce((a, b) => a + b, 0);

  const [progress, setProgress] = useState<{ done: number; total: number } | null>({ done: 0, total: ids.length });
  const [retrying, setRetrying] = useState<string | null>(null);
  const [removedBusyBy, setRemovedBusyBy] = useState<Record<string, boolean>>({}); // closing removed initiatives' issues: the main send waits
  const removedBusy = Object.values(removedBusyBy).some(Boolean);
  const detailsRef = useRef<Record<string, ItemDetail>>({}); // for the confirmed screen
  const picksRef = useRef<SyncChoice[]>([]); // the choices of the last confirm, so one failed initiative can be sent again on its own

  // the check runs in chunks of a few initiatives, so cards appear as they are ready (up to 25); the board is read once at the end
  useEffect(() => {
    let live = true;
    (async () => {
      let state = { received: [] as ReceiveItem[], send: [] as PlanItem[] };
      let account = "";
      setProgress({ done: 0, total: ids.length });
      for (const part of chunk(ids, CHECK_CHUNK)) {
        const r = await api.start(part, { board: false }).catch(() => null);
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
        const b = await api.board(linked).catch(() => null);
        if (!live) return;
        if (b && b.ok) { state = { ...state, received: applyBoardLines(state.received, b.lines, b.failed) }; setPhase({ kind: "preview", ...state, account }); }
      }
      setProgress(null);
    })();
    return () => { live = false; };
  }, [ids, api]);

  /** Checks one initiative again after its card said it could not be checked. */
  const retry = async (id: string) => {
    setRetrying(id);
    const r = await api.start([id], { board: false }).catch(() => null);
    setRetrying(null);
    if (!r || !r.ok) return;
    setPhase((p) => (p.kind === "preview" ? { ...p, ...mergeChecked(ids, p, { received: r.received, send: r.send }) } : p));
    setChoices((prev) => ({ ...defaults(r.received), ...prev }));
  };
  useEffect(() => { confirmRef.current?.focus(); }, [phase.kind]);
  useBusyTitle(phase.kind === "loading" || phase.kind === "writing");

  const preview = phase.kind === "preview" ? phase : null;
  const conflicts = preview ? preview.received.flatMap((r) => (r.conflicts ?? []).map((c) => ({ r, c }))) : [];
  const unchosen = conflicts.filter(({ r, c }) => !choices[keyOf(r.id, c.field)]);
  // what a confirm will write to GitHub: the plan's sends, plus every initiative where Product Velocity's text was chosen over GitHub's
  const sendIds = new Set(preview ? preview.send.filter((p) => p.action === "create" || p.action === "update" || p.ready?.will).map((p) => p.id) : []);
  for (const { r, c } of conflicts) if (choices[keyOf(r.id, c.field)] === "pv") sendIds.add(r.id);
  for (const r of preview?.received ?? []) if (r.assigneeSend) sendIds.add(r.id); // assignees changed in Product Velocity go out with the send
  for (const { r, c } of conflicts) if (c.field === "block" && choices[keyOf(r.id, c.field)] === "github" && !conflicts.some((x) => x.r.id === r.id && x.c.field !== "block" && choices[keyOf(r.id, x.c.field)] === "pv")) sendIds.delete(r.id);
  const overwrites = conflicts.filter(({ r, c }) => choices[keyOf(r.id, c.field)] === "pv").length;
  // only initiatives with something to apply or send go to the confirm, which checks GitHub again for exactly those
  const actionIds = preview ? ids.filter((id) => sendIds.has(id) || conflicts.some((x) => x.r.id === id)) : [];
  const needsConfirm = actionIds.length > 0;
  const checking = progress !== null;
  const incoming = (preview?.received ?? []).filter(hasIncoming);
  const counts = filterBySend(preview?.received ?? [], sendIds, updateFilter === "deletions" ? "all" : updateFilter);
  // while the check runs the person is on stage 1 (items arrive one by one); afterwards stage 1 is skipped when nothing came in
  const view: "incoming" | "outgoing" = checking ? stage : incoming.length > 0 ? stage : "outgoing";
  const trackerLabel = preview && preview.received.length > 0 && preview.received.every((r) => r.tracker === "jira") ? "Jira" : preview && preview.received.some((r) => r.tracker === "jira") ? "GitHub and Jira" : "GitHub";

  // "Keep GitHub for all" skips the values that cannot be taken over from the board: those stay Keep Product Velocity
  const choose = (all: "pv" | "github") => setChoices(Object.fromEntries(conflicts.map(({ r, c }) => [keyOf(r.id, c.field), c.githubPullable === false ? "pv" : c.pvPossible === false ? "github" : all])));
  /** Writes one initiative. GitHub is read again for it first: an edit made since the preview is returned instead of overwritten. */
  const writeOne = async (id: string, code: string, picks: SyncChoice[]): Promise<WrittenOne> => {
    try {
      const r = await api.confirm([id], picks.filter((x) => x.itemId === id));
      if (r.ok) return { kind: "result", results: r.results, taken: r.taken };
      if (r.stale) return { kind: "stale", stale: r.stale, error: r.error };
      return { kind: "result", results: [{ id, code, outcome: "error", message: r.error }], taken: [] };
    } catch {
      return { kind: "lost", results: [{ id, code, outcome: "error", message: LOST }] };
    }
  };
  /** Tells the grid what changed, once, after the writing stopped or finished. */
  const finish = (taken: TakenOver[]) => {
    // the grid knows the G2M date by its dictionary key, not by its column
    if (taken.length > 0) onTakenOver?.(taken.map((t) => (t.field === "end_date" ? { ...t, field: "g2m_date_est" as never } : t)));
    router.refresh();
    onDone?.();
  };

  // one initiative at a time, so the person sees "Writing x/y" and each result as it is ready; one failing never stops the others
  const send = async () => {
    if (!preview) return;
    const picks: SyncChoice[] = conflicts.map(({ r, c }) => ({ itemId: r.id, field: c.field, choice: choices[keyOf(r.id, c.field)]!, ghHash: c.ghHash }));
    picksRef.current = picks;
    const cards = { received: preview.received, send: preview.send };
    const codeOf = (id: string) => cards.received.find((r) => r.id === id)?.code ?? "";
    const todo = actionIds;
    // what came in and how conflicts were settled, kept for the confirmed screen
    const details: Record<string, ItemDetail> = Object.fromEntries(cards.received.map((c) => [c.id, { tracker: c.tracker ?? "github", received: c.received, settled: (c.conflicts ?? []).map((x) => ({ label: x.label, kept: (choices[keyOf(c.id, x.field)] === "pv" ? "pv" : "tracker") as "pv" | "tracker" })) }]));
    detailsRef.current = details;
    setPhase({ kind: "writing", done: 0, total: todo.length, results: preview.written ?? [] });
    const run = await writeAll({
      todo, codeOf, start: preview.written ?? [], writeOne: (id) => writeOne(id, codeOf(id), picks),
      onProgress: (done, total, results) => setPhase({ kind: "writing", done, total, results }),
    });
    if (run.stopped) {
      // GitHub changed for this one: it goes back to the preview with the new difference; those after it wait there too
      const { id, stale, error } = run.stopped;
      const open = mergeChecked(ids, dropWritten(cards, new Set(todo.slice(0, run.stopped.index))), { received: stale.received, send: stale.send });
      setChoices((prev) => ({ ...Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith(`${id}:`))), ...defaults(stale.received) }));
      setPhase({ kind: "preview", account: preview.account, ...open, notice: error, written: run.results });
    } else {
      setPhase({ kind: "done", results: run.results, details });
    }
    finish(run.taken);
  };

  /** Sends one failed or unsent initiative again with the choices made before. */
  const sendAgain = async (id: string) => {
    if (phase.kind !== "done") return;
    const results = phase.results;
    setRetrying(id);
    const code = results.find((r) => r.id === id)?.code ?? "";
    const o = await writeOne(id, code, picksRef.current);
    setRetrying(null);
    const fresh = o.kind === "stale" ? [{ id, code, outcome: "error" as const, message: `${o.error} Close this window and sync again.` }] : o.results;
    setPhase({ kind: "done", results: replaceResults(results, id, fresh), details: phase.details });
    if (o.kind === "result") finish(o.taken);
  };

  // the steps are over when none is left to show (derived, so there is no state to keep in step)
  if (step === "new" && configs.length > 0 && (queue === null || queue.length > 0)) {
    const current = queue?.[0];
    return (
      <div className="dialog-backdrop" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
        <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={focusDialog}>
          <h2 id={titleId}>Sync{current?.name ?? trackerNames ? ` with ${current?.name ?? trackerNames}` : ""}: new issues first</h2>
          <Steps current={1} tracker={current?.name ?? trackerNames} />
          {current ? <NewItemsStep key={current.tracker} config={current} onContinue={continueToSync} onCancel={onClose} {...(onDone ? { onChanged: onDone } : {})} /> : <Loading>Checking for new issues…</Loading>}
        </div>
      </div>
    );
  }

  return (
    <div className="dialog-backdrop" onKeyDown={(e) => { if (e.key === "Escape" && phase.kind !== "writing") { e.stopPropagation(); onClose(); } }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{phase.kind === "done" ? `Synced${trackerNames ? ` with ${trackerNames}` : ""}` : `Sync${trackerNames ? ` with ${trackerNames}` : ""}`}</h2>
        {phase.kind !== "error" && <Steps current={phase.kind === "done" || phase.kind === "writing" ? (phase.kind === "done" ? 3 : 2) : phase.kind === "loading" ? 1 : view === "incoming" ? 1 : 2} tracker={phase.kind === "preview" ? trackerLabel : trackerNames} />}

        {phase.kind === "loading" && (
          <>
            <Loading>Checking{trackerNames ? ` ${trackerNames}` : ""}… {progress ? `${progress.done} of ${progress.total}` : ""}</Loading>
            <div className="dialog-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button></div>
          </>
        )}
        {phase.kind === "writing" && (
          <>
            <p role="status" aria-live="polite" style={{ display: "flex", alignItems: "center", gap: 8 }}><PillLoader size={16} /><span><strong>{writingLabel(phase.done, phase.total)}</strong> · keep this window open.</span></p>
            <ResultList results={phase.results} />
          </>
        )}
        {phase.kind === "error" && (
          <>
            <p role="alert" className="error">{phase.message}</p>
            <div className="dialog-actions"><button ref={confirmRef} type="button" className="btn" onClick={onClose}>Close</button></div>
          </>
        )}

        {phase.kind === "preview" && (
          <>
            {phase.notice && <p role="alert" className="error"><strong>{phase.notice}</strong></p>}
            {phase.written && phase.written.length > 0 && <p role="status" className="muted">Already written: {phase.written.map((w) => w.code).filter((c, i, a) => c && a.indexOf(c) === i).join(", ") || `${phase.written.length}`}. The ones below are still open.</p>}
            {progress && <p role="status" aria-live="polite" className="muted">Checked {progress.done} of {progress.total}…</p>}

            {view === "incoming" && (
              <>
                <h3>Updates from {trackerLabel} to Product Velocity</h3>
                <p>
                  {phase.received.length > 0 && phase.received.every((r) => r.tracker === "jira") ? (
                    <>Product Velocity read the linked issues from <strong>Jira</strong>. What Jira owns (Build Status, from the status category of the issue) is already applied and listed below. Initiative Status is never set from Jira.</>
                  ) : <>
                    {phase.received.some((r) => r.tracker === "jira") && <>For the initiatives linked to Jira, Build Status is already applied. </>}
                    Product Velocity checked <strong>{phase.account}</strong> on GitHub. What GitHub owns (state, progress, epics and tasks, board Status) is already applied and listed below.
                  </>}
                  {" "}Text that changed on both sides, or only on the tracker, needs your choice before you continue. Nothing is written to the tracker in this step.
                </p>
                {conflicts.length > 1 && (
                  <div className="dialog-actions" role="group" aria-label="Settle all conflicts at once">
                    <button type="button" className="btn" onClick={() => choose("pv")}>Keep Product Velocity for all conflicts</button>
                    <button type="button" className="btn" onClick={() => choose("github")}>Keep {trackerLabel} for all conflicts</button>
                  </div>
                )}
                {incoming.length === 0 && !checking && <p role="status" className="muted">Nothing came in from {trackerLabel}.</p>}
                <ul className="push-list" aria-label="Updates coming in">
                  {incoming.map((r) => {
                    const tracker = r.tracker === "jira" ? "Jira" : "GitHub";
                    return (
                      <li key={r.id} className={r.status === "error" || r.status === "missing" ? "push-blocked" : undefined}>
                        <strong>{r.code}</strong> {r.name} · <span className="push-pill">{STATUS[r.status]}</span>
                        {(r.issueLabel || r.issueNumber) && r.issueUrl && <> · <a href={r.issueUrl} target="_blank" rel="noreferrer">{r.issueLabel ? `issue ${r.issueLabel}` : `issue #${r.issueNumber}`}</a></>}
                        {r.message && <><br /><span className="muted">{r.message}</span></>}
                        {r.status === "error" && !checking && <> <button type="button" className="btn" disabled={retrying === r.id} onClick={() => retry(r.id)}>{retrying === r.id ? "Checking…" : "Try again"}</button></>}
                        {r.received.length > 0 && (
                          <>
                            <br /><strong>Received from {tracker}</strong> (already applied)
                            {r.received.map((l) => <span key={l.label} className="muted" style={{ display: "block" }}>{l.label}: {l.from ?? "empty"} → {l.to ?? "empty"}</span>)}
                          </>
                        )}
                        {(r.conflicts ?? []).map((c) => {
                          const name = `choice-${r.id}-${c.field}`;
                          const value = choices[keyOf(r.id, c.field)];
                          return (
                            <fieldset key={c.field} className="push-conflict">
                              <legend><strong>Conflict · {c.label}</strong></legend>
                              <p className="muted">{WHY[c.kind](c.label, c.where, tracker)}{c.note ? ` ${c.note}` : ""}</p>
                              {c.kind !== "block" && (
                                <div className="push-sides">
                                  <div><strong>Product Velocity</strong><Text text={c.pv} /></div>
                                  <div><strong>{tracker}</strong><Text text={c.github} /></div>
                                </div>
                              )}
                              {c.kind === "block" && <p className="muted">{c.github}</p>}
                              <label><input type="radio" name={name} checked={value === "pv"} disabled={c.pvPossible === false} onChange={() => setChoices({ ...choices, [keyOf(r.id, c.field)]: "pv" })} /> Keep Product Velocity{c.pvPossible === false ? " (not possible)" : c.defaultChoice === "pv" ? " (default)" : ""}</label>{" "}
                              <label><input type="radio" name={name} checked={value === "github"} disabled={c.githubPullable === false} onChange={() => setChoices({ ...choices, [keyOf(r.id, c.field)]: "github" })} /> Keep {tracker}{c.githubPullable === false ? " (not possible)" : c.defaultChoice === "github" ? " (default)" : ""}</label>
                            </fieldset>
                          );
                        })}
                      </li>
                    );
                  })}
                </ul>
                {unchosen.length > 0 && <p role="status" className="muted">Choose for {unchosen.length === 1 ? "the conflict above" : `all ${unchosen.length} open conflicts`} to continue.</p>}
                <div className="dialog-actions">
                  <button type="button" className="btn" onClick={onClose}>Cancel</button>
                  <button ref={confirmRef} type="button" className="btn btn-primary" disabled={unchosen.length > 0 || checking} onClick={() => setStage("outgoing")}>{checking ? <><PillLoader size={14} tone="white" />Checking…</> : `Next: what goes to ${trackerLabel}`}</button>
                </div>
              </>
            )}

            {view === "outgoing" && (
              <>
                <h3>Updates from Product Velocity to {trackerLabel}</h3>
                <p>
                  Nothing is written to {trackerLabel} until you confirm.{" "}
                  {phase.received.every((r) => r.tracker === "jira") && phase.received.length > 0
                    ? <>If you send, only the name, description, links, links to documents and files you chose to share, labels starting with “pv:”, the due date (G2M Date) and, where the Jira site has them mapped, the start date and priority go out; value, confidence, customers, decisions and other commercial fields never leave the app, and status is never written. Anything else in the issue stays as it is.</>
                    : <>If you send, only the name, summary, description, hypothesis, links, links to documents and files you chose to share (private repositories only), a few labels, a milestone, the fields of the linked GitHub Project board and a link back go out; value, confidence, customers, decisions and other commercial fields never leave the app. The repository may be public.</>}
                </p>
                <div className="push-filters" role="group" aria-label="Filter the results">
                  {([["all", `All (${counts.toSend + counts.nothing})`], ["updates", `To send (${counts.toSend})`], ["none", `Nothing to send (${counts.nothing})`], ...(removedCount > 0 ? [["deletions", `Deletions (${removedCount})`] as const] : [])] as const).map(([k, text]) => (
                    <button key={k} type="button" className={`chip${updateFilter === k ? " chip-on" : ""}`} aria-pressed={updateFilter === k} onClick={() => setUpdateFilter(k)}>{text}</button>
                  ))}
                </div>
                {counts.problems > 0 && <p role="status" className="muted">{counts.problems === 1 ? "1 initiative could not be checked" : `${counts.problems} initiatives could not be checked`}: see step 1.</p>}
                {counts.shown.length === 0 && !checking && updateFilter !== "deletions" && <p role="status" className="muted">Nothing to show for this filter.</p>}
                <ul className="push-list" aria-label="Updates going out" style={updateFilter === "deletions" ? { display: "none" } : undefined}>
                  {counts.shown.map((r) => {
                    const p = r.readOnly ? undefined : phase.send.find((x) => x.id === r.id);
                    const sendsIssue = p?.action === "create" || p?.action === "update";
                    const sends = sendIds.has(r.id);
                    const tracker = r.tracker === "jira" ? "Jira" : "GitHub";
                    return (
                      <li key={r.id} className={p?.action === "blocked" ? "push-blocked" : undefined}>
                        <strong>{r.code}</strong> {r.name} · <StatusPill value={sends ? "To send" : "Nothing to send"} tone={sends ? "info" : "neutral"} />
                        {(r.issueLabel || r.issueNumber) && r.issueUrl && <> · <a href={r.issueUrl} target="_blank" rel="noreferrer">{r.issueLabel ? `issue ${r.issueLabel}` : `issue #${r.issueNumber}`}</a></>}
                        {r.readOnly && <><br /><span className="muted">Follows this issue read-only: nothing to send.</span></>}
                        {!sends && !r.readOnly && !p?.action && <><br /><span className="muted">Everything is in step.</span></>}
                        {r.assigneeSend && (r.assigneeSend.add.length > 0 || r.assigneeSend.remove.length > 0) && (
                          <><br /><strong>Assignees to send</strong>{" "}
                            <span className="muted">{[...r.assigneeSend.add.map((l) => `add @${l}`), ...r.assigneeSend.remove.map((l) => `remove @${l}`)].join(", ")}</span></>
                        )}
                        {(r.conflicts ?? []).filter((c) => choices[keyOf(r.id, c.field)] === "pv").map((c) => <span key={c.field} className="muted" style={{ display: "block" }}>{c.label}: Keep Product Velocity, replaces the text in {tracker}.</span>)}
                        {p && (
                          <>
                            <br /><span className="muted">{WILL[p.action](p)}</span>
                            {p.ready && <><br /><strong>Ready for build:</strong> <span className={p.ready.will ? undefined : "muted"}>{p.ready.text}{p.ready.will && p.tracker !== "jira" ? " (board Status, only while it is still at the start)" : ""}</span></>}
                            {sendsIssue && (
                              <details>
                                <summary>See what will be written</summary>
                                <p><strong>Writes:</strong> {(p.tracker === "jira" ? ["Name", "Description (Summary, Description, Hypothesis, Links, Files, Documents), as far as they changed", "Labels"] : wroteGithub({ title: p.title, block: p.block, labels: p.labels, milestone: p.milestone ?? null, board: p.board })).join(", ")}</p>
                                <p><strong>Title:</strong> {p.title}</p>
                                <p><strong>Labels:</strong> {p.labels.join(", ") || "(none)"}</p>
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
                                {(p.notes ?? []).map((n) => <p key={n} role="note" className="muted">{n}</p>)}
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
                {phase.received.some((r) => r.tracker === "jira") && <p className="muted">Jira keeps a description in its own format. Product Velocity rewrites a description only when its text changed since the last sync; a table, macro or mention in Jira is never flattened otherwise.</p>}
                {phase.received.some((r) => r.tracker !== "jira") && <p className="muted">Text you or engineers write in the issue outside the marked block is kept. The marked block is overwritten the next time you send.</p>}
                {overwrites > 0 && <p role="note" className="muted">Keep Product Velocity replaces the text in {trackerLabel} with Product Velocity’s when you press Apply and send.{phase.received.some((r) => r.tracker !== "jira") ? " Anything outside the marked block stays." : ""}</p>}
                {(["github", "jira"] as const).map((t) => {
                  const removedApi = api.removed?.[t];
                  // GitHub is also the tracker of a project that has none yet (a card without a tracker is a GitHub card)
                  return removedApi && !checking && phase.received.some((r) => (r.tracker ?? "github") === t) ? (
                    <div key={t} style={updateFilter === "updates" || updateFilter === "none" ? { display: "none" } : undefined}>
                      <RemovedSection api={removedApi} tracker={t} onBusy={(b) => setRemovedBusyBy((prev) => ({ ...prev, [t]: b }))} onCount={(n) => setRemovedCounts((prev) => ({ ...prev, [t]: n }))} />
                    </div>
                  ) : null;
                })}
                <div className="dialog-actions">
                  {incoming.length > 0 && !checking && <button type="button" className="btn" onClick={() => setStage("incoming")}>Back</button>}
                  {needsConfirm && <button type="button" className="btn" onClick={onClose}>Cancel</button>}
                  <button ref={confirmRef} type="button" className={!needsConfirm ? "btn" : sendIds.size > 0 ? "btn btn-confirm" : "btn btn-primary"} disabled={unchosen.length > 0 || checking || removedBusy} onClick={needsConfirm ? send : onClose}>
                    {checking ? "Checking…" : !needsConfirm ? "Done" : sendIds.size > 0 ? "Apply and send" : "Apply"}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {phase.kind === "done" && (
          <>
            <ConfirmedList results={phase.results} details={phase.details} onRetry={sendAgain} retrying={retrying} />
            <div className="dialog-actions"><button ref={confirmRef} type="button" className="btn" onClick={onClose}>Close</button></div>
          </>
        )}
      </div>
    </div>
  );
}
