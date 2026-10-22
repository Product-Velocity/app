"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { EDITABLE_FIELDS, FIELD_BY_KEY, activityEvents, canUndoActivity, panelSections, type ActivityEvent, type ActivityRow } from "@pv/domain";
import type { PortfolioController } from "./controller";
import { FieldRow, type FieldCtx } from "./item-fields";
import { formatField } from "./format";
import { useStatus } from "./status-strip";
import type { Lookups } from "./types";

type Tab = "overview" | "spec" | "github" | "alignment" | "activity";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "spec", label: "Spec" },
  { id: "github", label: "GitHub" },
  { id: "alignment", label: "Alignment" },
  { id: "activity", label: "Activity" },
];

const defaultPageHref = (code: string) => `/portfolio/${encodeURIComponent(code)}`;

export type ItemPanelProps = {
  controller: PortfolioController;
  lookups: Lookups;
  itemId: string;
  me: string | null;
  mode: "peek" | "page";
  /** Position in the current view order, for "3 of 40" and the J/K buttons. */
  position?: { index: number; total: number };
  onClose?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  height?: number;
  /** Address of an item's page and of the roadmap (the test page uses its own). */
  pageHref?: (code: string) => string;
  backHref?: string;
};

/** The item panel: beside the grid ("peek") or as a page of its own. Same fields, same autosave and undo as the grid. */
export function ItemPanel({ controller, lookups, itemId, me, mode, position, onClose, onPrev, onNext, height, pageHref = defaultPageHref, backHref = "/portfolio" }: ItemPanelProps) {
  useStatus(controller);
  const row = controller.row(itemId);
  const [tab, setTab] = useState<Tab>("overview");
  const titleId = useId();
  const ctx = useMemo<FieldCtx>(() => ({ controller, lookups }), [controller, lookups]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // the lists of this item (tags, links, ...) are read when the panel opens on it
  useEffect(() => {
    let cancelled = false;
    controller.loadRelated(itemId).then(() => { if (!cancelled) setLoadError(null); }, (e: Error) => { if (!cancelled) setLoadError(e.message); });
    return () => { cancelled = true; };
  }, [controller, itemId]);
  // moving to another item starts at the top of the Overview
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [itemId, tab]);

  if (!row) {
    return (
      <aside className={`item-panel item-panel-${mode}`} aria-label="Item" style={height ? { height } : undefined}>
        <p className="muted">This initiative no longer exists or you cannot see it.</p>
        {onClose && <button type="button" className="btn" onClick={onClose}>Close</button>}
      </aside>
    );
  }
  const project = lookups.projects.find((p) => p.id === row.home_project)?.name ?? "";
  const status = row.status ? String(row.status) : "";

  return (
    <aside className={`item-panel item-panel-${mode}`} aria-labelledby={titleId} style={height ? { height } : undefined} data-testid="item-panel">
      <header className="ip-head">
        <div className="ip-nav">
          {mode === "peek" && onPrev && <button type="button" className="btn ip-icon" onClick={onPrev} aria-label="Previous initiative (K)" title="Previous (K)">↑</button>}
          {mode === "peek" && onNext && <button type="button" className="btn ip-icon" onClick={onNext} aria-label="Next initiative (J)" title="Next (J)">↓</button>}
          {position && <span className="muted ip-pos" aria-live="polite">{position.index + 1} of {position.total}</span>}
          <span className="ip-spacer" />
          {mode === "peek" && <Link className="btn ip-link" href={pageHref(row.item_code)}>Open full page</Link>}
          {mode === "page" && <Link className="btn ip-link" href={backHref}>Back to the roadmap</Link>}
          {mode === "peek" && onClose && <button type="button" className="btn ip-icon" onClick={onClose} aria-label="Close panel (Esc)" title="Close (Esc)">×</button>}
        </div>
        <p className="ip-code mono">{row.item_code}{project && <span className="proj-pill">{project}</span>}{status && <span className="muted"> · {status}</span>}</p>
        <h2 id={titleId} className="ip-title">{row.initiative_name}</h2>
        <p className="muted ip-rank">#{row.stack_rank} globally · #{row.project_rank} in {project || "its project"}</p>
      </header>

      <div role="tablist" aria-label="Item sections" className="ip-tabs">
        {TABS.map((t) => (
          <button
            key={t.id} type="button" role="tab" id={`${titleId}-tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`${titleId}-panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? "ip-tab ip-tab-on" : "ip-tab"} onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const i = TABS.findIndex((x) => x.id === tab);
              const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]!;
              setTab(next.id);
              requestAnimationFrame(() => document.getElementById(`${titleId}-tab-${next.id}`)?.focus());
            }}
          >{t.label}</button>
        ))}
      </div>

      <div ref={bodyRef} className="ip-body" role="tabpanel" id={`${titleId}-panel-${tab}`} aria-labelledby={`${titleId}-tab-${tab}`}>
        {loadError && <p role="alert" className="pf-error">Could not load the lists of this initiative: {loadError}</p>}
        {tab === "overview" && <Overview ctx={ctx} itemId={itemId} />}
        {tab === "spec" && <EmptyTab title="Spec" text="Specs, documents and the readiness checklist arrive in phase 4. Until then the hypothesis and artifacts live on the Overview tab." />}
        {tab === "github" && <GithubTab />}
        {tab === "alignment" && <EmptyTab title="Alignment" text="Votes, sign-offs and the decision log for this initiative arrive with alignment, in phases 5 and 8." />}
        {tab === "activity" && <ActivityTab controller={controller} lookups={lookups} itemId={itemId} me={me} />}
      </div>
    </aside>
  );
}

function Overview({ ctx, itemId }: { ctx: FieldCtx; itemId: string }) {
  const row = ctx.controller.row(itemId)!;
  const sections = useMemo(() => panelSections(), []);
  return (
    <div className="ip-overview">
      <HealthBlock ctx={ctx} itemId={itemId} />
      {sections.map((s) => (
        <details key={s.group} className="ip-section" open={!s.allLater && ["What", "Who", "Why", "When"].includes(s.group)}>
          <summary>
            <h3>{s.group}</h3>
            <span className="muted">{s.allLater ? `arrives in phase ${Math.min(...s.fields.map((f) => f.phase))}` : `${s.fields.length} fields`}</span>
          </summary>
          <div className="ip-fields">{s.fields.filter((f) => f.key !== "health").map((f) => <FieldRow key={f.key} f={f} row={row} ctx={ctx} />)}</div>
        </details>
      ))}
    </div>
  );
}

/** Health is set by people. The suggestion banner has its place here; suggestions arrive with GitHub sync (phase 3). */
function HealthBlock({ ctx, itemId }: { ctx: FieldCtx; itemId: string }) {
  const row = ctx.controller.row(itemId)!;
  const f = FIELD_BY_KEY.health!;
  const reviewed = row.last_reviewed_at ? formatField(FIELD_BY_KEY.last_reviewed_at!, row.last_reviewed_at, { today: ctx.controller.todayDate(), members: ctx.lookups.members, projects: ctx.lookups.projects }) : null;
  const today = ctx.controller.todayDate().toISOString().slice(0, 10);
  return (
    <section className="ip-health" aria-label="Health">
      <FieldRow f={f} row={row} ctx={ctx} />
      <div className="ip-review">
        <button type="button" className="btn" disabled={!ctx.controller.canEdit || row.last_reviewed_at === today} onClick={() => ctx.controller.edit(itemId, "last_reviewed_at", today)}>Mark reviewed</button>
        <span className="muted">{reviewed ? `Last reviewed ${reviewed}` : "Not reviewed yet"}</span>
      </div>
      <SuggestionBanner suggestion={null} />
    </section>
  );
}

export type HealthSuggestion = { health: string; reasons: string[] };
/** Shows a suggested health with the reasons in words, and Apply and Dismiss. Nothing is suggested before phase 3. */
export function SuggestionBanner({ suggestion, onApply, onDismiss }: { suggestion: HealthSuggestion | null; onApply?: () => void; onDismiss?: () => void }) {
  if (!suggestion) return null;
  return (
    <div className="ip-suggestion" role="status">
      <strong>Suggested health: {suggestion.health}</strong>
      <p>{suggestion.reasons.join(" ")}</p>
      <button type="button" className="btn" onClick={onApply}>Apply</button> <button type="button" className="btn" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}

function EmptyTab({ title, text }: { title: string; text: string }) {
  return (
    <div className="ip-empty">
      <h3>{title}</h3>
      <p className="muted">{text}</p>
    </div>
  );
}

/** Empty state with the layout GitHub sync will fill: epics with nested tasks (board 2). */
function GithubTab() {
  return (
    <div className="ip-empty">
      <h3>GitHub</h3>
      <p className="muted">No GitHub issue is linked to this initiative yet. After GitHub sync ships (phase 3), the tracking issue appears here with its epics and the tasks nested under each epic.</p>
      <table className="table ip-gh" aria-label="Epics and tasks (empty)">
        <thead>
          <tr>{["Issue", "Title", "State", "Assignee", "Created by", "Pull request", "Updated"].map((h) => <th key={h} scope="col">{h}</th>)}</tr>
        </thead>
        <tbody><tr><td colSpan={7} className="muted">Epics and tasks will be listed here.</td></tr></tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ activity
function ActivityTab({ controller, lookups, itemId, me }: { controller: PortfolioController; lookups: Lookups; itemId: string; me: string | null }) {
  useStatus(controller);
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const version = controller.status.version;
  const pending = controller.status.pending;

  useEffect(() => {
    if (pending > 0) return; // read again once the saves have finished, so the log includes them
    let cancelled = false;
    controller.activity(itemId).then((r) => { if (!cancelled) { setRows(r); setError(null); } }, (e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [controller, itemId, reload, pending, version]);

  const events = useMemo(() => (rows ? activityEvents(rows) : []), [rows]);
  const row = controller.row(itemId);
  const who = (id: string | null) => (id ? lookups.members.find((m) => m.user_id === id)?.email ?? "someone" : "the system");
  const fmt = (e: ActivityEvent, v: unknown) => {
    const f = FIELD_BY_KEY[e.field];
    if (v === null || v === undefined || v === "") return "empty";
    return f ? formatField(f, v, { today: controller.todayDate(), members: lookups.members, projects: lookups.projects }) || String(v) : String(v);
  };
  if (error) return <p role="alert" className="pf-error">Could not load the activity: {error}</p>;
  if (!rows) return <p role="status" className="muted">Loading the activity…</p>;
  return (
    <div className="ip-activity">
      <h3>Activity</h3>
      <p className="muted">Every change to this initiative, with who made it and where it came from. You can undo your own changes to a field while the field still has the value you set.</p>
      {message && <p role="status" className="notice">{message}</p>}
      {events.length === 0 && <p className="muted">Nothing has changed yet.</p>}
      <ol className="ip-log">
        {events.map((e) => {
          const undo = canUndoActivity(e, me, row ? (row as Record<string, unknown>)[e.field] : null);
          return (
            <li key={`${e.id}`}>
              <p>
                <strong>{e.label}</strong>{" "}
                {e.kind === "changed" ? <>changed from {fmt(e, e.old)} to {fmt(e, e.new)}</> : e.kind === "added" ? <>added {e.detail}</> : <>removed {e.detail}</>}
              </p>
              <p className="muted">
                {who(e.actorId)} · {e.via} · <time dateTime={e.at}>{new Date(e.at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
                {undo.ok && controller.canEdit && (EDITABLE_FIELDS.includes(e.field) || e.field === "effort_by_skill") && (
                  <>
                    {" · "}
                    <button type="button" className="link-button" aria-label={`Undo the change to ${e.label}`} onClick={() => {
                      const r = controller.restoreValue(itemId, e.field, e.new, e.old);
                      setMessage(r.ok ? `Put ${e.label} back to ${fmt(e, e.old)}.` : r.error);
                      setReload((n) => n + 1);
                    }}>Undo</button>
                  </>
                )}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
