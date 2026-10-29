"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CURRENT_PHASE, FIELD_BY_KEY, LEADERSHIP_COLUMNS, categoryMix, changesThisWeek, draftWeeklyUpdate, formatDate, healthByProject, needsAttention, topItems, weekWindow,
  type AuditChange, type HealthState,
} from "@pv/domain";
import type { PortfolioController } from "../portfolio/controller";
import { formatField } from "../portfolio/format";
import { ItemPanel } from "../portfolio/item-panel";
import type { GridItem, Lookups } from "../portfolio/types";
import { useViewRows } from "../portfolio/use-view-rows";
import { scopeParam, setQueryParam } from "../workspace/scope";
import type { LeadershipStore, WeeklyUpdate } from "./store";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, "-");
const HEALTH_ORDER: HealthState[] = ["On Track", "At Risk", "Delayed", "Blocked", "No health"];

export type LeadershipProps = { controller: PortfolioController; lookups: Lookups; me: string | null; store: LeadershipStore; pageHref?: (code: string) => string };

/** The leadership view: portfolio health, what needs attention, the mix, what moved, and the weekly update. Read-only. */
export function LeadershipView({ controller, lookups, me, store, pageHref }: LeadershipProps) {
  const params = useSearchParams();
  const { rows, scope } = useViewRows(controller, me);
  const today = controller.todayDate();
  const week = useMemo(() => weekWindow(today), [today]);
  const [peekId, setPeekState] = useState<string | null>(() => { const c = params.get("item"); return c ? controller.rows.find((r) => r.item_code === c)?.id ?? null : null; });
  const openPeek = useCallback((id: string | null) => { setPeekState(id); setQueryParam("item", id ? controller.row(id)?.item_code ?? null : null); }, [controller]);
  useEffect(() => {
    if (!peekId) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target as HTMLElement).closest("input, textarea, select, [role=dialog], [role=menu]")) openPeek(null); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [peekId, openPeek]);

  // ---- what moved this week, from the audit log
  const [audit, setAudit] = useState<AuditChange[] | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    store.loadChanges(`${week.start}T00:00:00.000Z`).then((c) => { if (!cancelled) setAudit(c); }, (e: Error) => { if (!cancelled) setAuditError(e.message); });
    return () => { cancelled = true; };
  }, [store, week.start]);
  const moves = useMemo(() => changesThisWeek(audit ?? [], rows), [audit, rows]);

  const health = useMemo(() => healthByProject(rows, lookups.projects), [rows, lookups.projects]);
  const attention = useMemo(() => needsAttention(rows, today), [rows, today]);
  const mix = useMemo(() => categoryMix(rows), [rows]);
  const top = useMemo(() => topItems(rows, 10), [rows]);
  const columns = useMemo(() => LEADERSHIP_COLUMNS.map((c) => FIELD_BY_KEY[c.key]!).filter((f) => f.phase <= CURRENT_PHASE), []);
  const later = useMemo(() => LEADERSHIP_COLUMNS.map((c) => FIELD_BY_KEY[c.key]!).filter((f) => f.phase > CURRENT_PHASE), []);
  const fmt = (f: (typeof columns)[number], r: GridItem) => formatField(f, r[f.key], { today, members: lookups.members, projects: lookups.projects });
  const open = (r: { id: string; item_code: string }) => <button type="button" className="gl-open" onClick={() => openPeek(r.id)}><span className="mono">{r.item_code}</span></button>;
  const onTrack = health.totals.counts["On Track"];
  const todayIso = today.toISOString().slice(0, 10);
  const horizon = new Date(today.getTime() + 14 * 86_400_000).toISOString().slice(0, 10);
  const dueSoon = rows.filter((r) => typeof r.g2m_date_est === "string" && r.g2m_date_est >= todayIso && r.g2m_date_est <= horizon && !["Done", "Cancelled"].includes(String(r.status)) && !["Completed", "Sunset"].includes(String(r.initiative_phase))).length;
  const attentionWords = [
    ["Blocked", attention.filter((a) => a.health === "Blocked").length], ["Delayed", attention.filter((a) => a.health === "Delayed").length],
    ["At Risk", attention.filter((a) => a.health === "At Risk").length], ["late", attention.filter((a) => !a.health || a.health === "On Track").length],
  ].filter(([, n]) => (n as number) > 0).map(([l, n]) => `${n} ${l}`).join(", ");

  return (
    <div className="leadership">
      <div className="page-head leadership-head">
        <h1>Leadership</h1>
        <p className="muted">{week.label} · {scope.label} · read-only</p>
      </div>

      <div className={peekId ? "gantt-split gantt-split-open" : "gantt-split"}>
        <div className="leadership-main">
          <div className="lead-tiles" role="group" aria-label="Summary">
            <div className="lead-tile"><span className="lead-num">{rows.length}</span><span>initiatives in this scope</span></div>
            <div className="lead-tile"><span className="lead-num">{onTrack} of {rows.length}</span><span>On Track</span></div>
            <div className="lead-tile"><span className="lead-num">{attention.length}</span><span>need attention{attentionWords ? `: ${attentionWords}` : ""}</span></div>
            <div className="lead-tile"><span className="lead-num">{dueSoon}</span><span>due by G2M in the next two weeks</span></div>
          </div>

          <section className="lead-section" aria-labelledby="lead-health">
            <h2 id="lead-health">Portfolio health by project</h2>
            {health.projects.length === 0 ? <p className="muted">No initiatives in this scope.</p> : (
              <table className="table lead-table">
                <thead><tr><th scope="col">Project</th><th scope="col">Initiatives</th><th scope="col">Health</th></tr></thead>
                <tbody>
                  {health.projects.map((p) => (
                    <tr key={p.id} data-project={p.id}>
                      <th scope="row">{p.name}</th>
                      <td>{p.total}</td>
                      <td>
                        <div className="lead-bar" aria-hidden="true">{HEALTH_ORDER.filter((s) => p.counts[s] > 0).map((s) => <span key={s} className={`lead-seg lead-seg-${slug(s)}`} style={{ flexGrow: p.counts[s] }} />)}</div>
                        <span className="lead-words">{HEALTH_ORDER.filter((s) => p.counts[s] > 0).map((s) => `${p.counts[s]} ${s}`).join(" · ")}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="lead-section" aria-labelledby="lead-attn">
            <h2 id="lead-attn">Needs attention <span className="gl-count">{attention.length}</span></h2>
            {attention.length === 0 ? <p className="muted">Nothing needs attention.</p> : (
              <ul className="lead-list" data-testid="attention">
                {attention.map((a) => (
                  <li key={a.id}>
                    {open({ id: a.id, item_code: a.code })} <span className="lead-name">{a.name}</span>{" "}
                    {a.health && <span className={`pill health-${slug(a.health)}`}>{a.health}</span>}
                    <span className="muted"> {a.reasons.join(". ")}.</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="lead-section" aria-labelledby="lead-top">
            <h2 id="lead-top">Top items by global rank</h2>
            <div className="lead-scroll">
              <table className="table lead-table" data-testid="top-items">
                <thead><tr>{columns.map((f) => <th key={f.key} scope="col">{f.name}</th>)}</tr></thead>
                <tbody>
                  {top.map((r) => (
                    <tr key={r.id} data-item={r.id}>
                      {columns.map((f) => (
                        <td key={f.key} className={f.key === "stack_rank" ? "num" : undefined}>
                          {f.key === "item_code" ? open(r) : f.key === "stack_rank" ? `#${r.stack_rank}` : f.key === "health" && r.health ? <span className={`pill health-${slug(String(r.health))}`}>{String(r.health)}</span> : fmt(f, r)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted lead-note">Columns of the Leadership view. {later.length > 0 && `${later.map((f) => `${f.name} (phase ${f.phase})`).join(", ")} arrive with their phases.`}</p>
          </section>

          <section className="lead-section" aria-labelledby="lead-moved">
            <h2 id="lead-moved">What moved this week <span className="gl-count">{moves.length}</span></h2>
            {auditError && <p role="alert" className="pf-error">Could not read the changes of this week: {auditError}</p>}
            {!audit && !auditError && <p role="status" className="muted">Reading the changes…</p>}
            {audit && moves.length === 0 && <p className="muted">No rank, status or health changes this week.</p>}
            <ul className="lead-list" data-testid="moves">
              {moves.map((m, i) => <li key={`${m.itemId}-${m.kind}-${i}`}>{m.text} <span className="muted">· {formatDate(m.at.slice(0, 10), today)}</span></li>)}
            </ul>
          </section>

          <section className="lead-section" aria-labelledby="lead-mix">
            <h2 id="lead-mix">Investment mix by Roadmap Category</h2>
            <ul className="lead-mix" data-testid="mix">
              {mix.filter((m) => m.count > 0 || m.label !== "No category").map((m) => (
                <li key={m.label}>
                  <span className="lead-mix-label">{m.label}</span>
                  <span className="lead-mix-bar" aria-hidden="true"><span style={{ width: `${m.pct}%` }} /></span>
                  <span className="lead-mix-num">{m.count} · {m.pct}%</span>
                </li>
              ))}
            </ul>
          </section>

          <WeeklyUpdatePanel controller={controller} lookups={lookups} rows={rows} moves={moves} scopeKey={scopeParam(scope.selection) ?? "all"} scopeLabel={scope.label} week={week.start} store={store} openPeek={openPeek} />
        </div>
        {peekId && <ItemPanel controller={controller} lookups={lookups} itemId={peekId} me={me} mode="peek" onClose={() => openPeek(null)} pageHref={pageHref} />}
      </div>
    </div>
  );
}

function WeeklyUpdatePanel({ controller, lookups, rows, moves, scopeKey, scopeLabel, week, store, openPeek }: {
  controller: PortfolioController; lookups: Lookups; rows: GridItem[]; moves: ReturnType<typeof changesThisWeek>; scopeKey: string; scopeLabel: string; week: string;
  store: LeadershipStore; openPeek: (id: string | null) => void;
}) {
  const canEdit = controller.canEdit;
  const today = controller.todayDate();
  const [update, setUpdate] = useState<WeeklyUpdate | null | undefined>(undefined);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);

  useEffect(() => {
    let cancelled = false;
    store.getUpdate(week, scopeKey).then((u) => { if (!cancelled) { setUpdate(u); setText(u?.body ?? ""); setError(null); } }, (e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [store, week, scopeKey]);

  const draft = useMemo(() => draftWeeklyUpdate({ rows, projects: lookups.projects, scopeLabel, today, changes: moves }), [rows, lookups.projects, scopeLabel, today, moves]);
  const who = (id: string | null) => (id ? lookups.members.find((m) => m.user_id === id)?.email ?? "someone" : "someone");
  const when = (iso: string) => formatDate(iso.slice(0, 10), today);

  const save = async (body: string) => {
    const r = await store.saveDraft(week, scopeKey, scopeLabel, body);
    if (r.ok) { setUpdate(r.value); setText(r.value.body); setError(null); setMessage(null); } else setError(r.error);
    return r.ok;
  };
  const review = async () => {
    if (!update) return;
    if (text !== update.body && !(await save(text))) return;
    const id = update.id;
    const r = await store.markReviewed(id);
    if (r.ok) { setUpdate(r.value); setMessage("Marked as reviewed. Nothing was sent anywhere: copy the text to share it."); setError(null); } else setError(r.error);
  };
  const sources = draft.sources.map((id) => controller.row(id)).filter((r): r is GridItem => !!r);

  if (update === undefined && !error) return <section className="lead-section" aria-labelledby="lead-update"><h2 id="lead-update">Weekly update</h2><p role="status" className="muted">Loading…</p></section>;

  return (
    <section className="lead-section lead-update" aria-labelledby="lead-update" data-testid="weekly-update">
      <h2 id="lead-update">Weekly update</h2>
      <p className="muted">{canEdit ? "Drafted from the data, then edited and reviewed by a person. Nothing is sent anywhere automatically." : "Written and reviewed by the team. Nothing is sent anywhere automatically."}</p>
      {error && <p role="alert" className="pf-error">{error}</p>}
      {message && <p role="status" className="notice">{message}</p>}

      {canEdit ? (
        <>
          {!update ? (
            <button type="button" className="btn btn-primary" onClick={() => void save(draft.text)}>Draft weekly update</button>
          ) : (
            <>
              <label htmlFor="lead-text" className="pf-label">Weekly update text</label>
              <textarea id="lead-text" className="lead-text" rows={18} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => { if (text !== update.body && text.trim() !== "") void save(text); }} />
              <p className="lead-status" role="status">
                {update.reviewedAt ? `Reviewed by ${who(update.reviewedBy)} on ${when(update.reviewedAt)}.` : text !== update.body ? "Unsaved changes. Leave the box to save." : "Draft, not reviewed yet."}
              </p>
              <div className="lead-actions">
                <button type="button" className="btn btn-primary" disabled={!!update.reviewedAt && text === update.body} onClick={() => void review()}>Mark reviewed</button>
                <button type="button" className="btn" onClick={() => { void navigator.clipboard?.writeText(text); setMessage("Copied. Paste it where you want to share it."); }}>Copy text</button>
                {!confirmNew
                  ? <button type="button" className="btn" onClick={() => setConfirmNew(true)}>Draft again from the data</button>
                  : <span className="lead-confirm">Replace the text with a new draft? Your edits are lost. <button type="button" className="btn btn-danger" onClick={() => { setConfirmNew(false); void save(draft.text); }}>Yes, replace it</button> <button type="button" className="btn" onClick={() => setConfirmNew(false)}>Keep my text</button></span>}
              </div>
              {sources.length > 0 && (
                <p className="muted lead-sources">This draft draws on: {sources.map((r, i) => <span key={r.id}>{i > 0 && ", "}<button type="button" className="gl-open" onClick={() => openPeek(r.id)}><span className="mono">{r.item_code}</span></button></span>)}</p>
              )}
            </>
          )}
        </>
      ) : update?.reviewedAt ? (
        <>
          <pre className="lead-text lead-readonly" data-testid="reviewed-text">{update.body}</pre>
          <p className="lead-status">Reviewed by {who(update.reviewedBy)} on {when(update.reviewedAt)}.</p>
        </>
      ) : (
        <p className="muted">{update ? "A draft exists but has not been reviewed yet." : "There is no reviewed update for this week yet."}</p>
      )}
    </section>
  );
}
