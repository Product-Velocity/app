"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AgGridReact, type CustomCellRendererProps, type CustomHeaderProps } from "ag-grid-react";
import type { ColDef, ColumnMovedEvent, RowClickedEvent } from "ag-grid-community";
import { METHODS, NEXT_STATE, STATE_LABEL, type SessionState } from "@/lib/alignment";
import {
  ALIGN_GROUP_BYS, NEED_LABEL, NO_FILTERS, appliedState, filterCount, filterRows, groupSessionRows, needCounts, needsYou, participation, quarterOptions, quarterText, sortRows, summarize, toCsv,
  type AlignGroupBy, type Filters, type Need, type SessionRow, type SortKey,
} from "@/lib/alignment-list";
import { DEFAULT_COL_DEF, GRID_THEME, GroupRowRenderer, isGroup } from "../portfolio/grid-kit";
import { AlignmentBar, AlignmentChips } from "./alignment-bar";
import { NewSessionDialog, type CreateSession, type Initiative } from "./new-session-dialog";

export type SetSessionState = (id: string, to: SessionState) => Promise<{ ok: true } | { ok: false; error: string }>;
const NEEDS: Need[] = ["no-participants", "confirm-mailing", "closing-soon", "not-applied"];
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "–");
const methodName = (m: SessionRow["method"]) => METHODS.find((x) => x.value === m)?.label ?? m;
const STATE_TONE: Record<SessionState, string> = { draft: "neutral", open: "info", closed: "good", archived: "neutral" };

type Ctx = {
  toggleGroup: (key: string) => void; link: (r: SessionRow) => string; results: (r: SessionRow) => string; session: (r: SessionRow) => string; isAdmin: boolean; now: Date;
  people: Record<string, string>; sort: { key: SortKey; dir: "asc" | "desc" }; sortBy: (k: SortKey) => void; step: (r: SessionRow) => void;
};
type Col = { id: string; name: string; admin?: boolean; text?: (r: SessionRow, c: Ctx) => string | number | null; def: ColDef<SessionRow> };

const SortHeader = (p: CustomHeaderProps & { sortKey?: SortKey; dir?: "asc" | "desc" | null }) => {
  const c = p.context as Ctx;
  if (!p.sortKey) return <span>{p.displayName}</span>;
  const on = !!p.dir;
  return (
    <button type="button" className="th-sort" aria-label={`Sort by ${p.displayName}${on ? (p.dir === "asc" ? ", ascending" : ", descending") : ""}`} onClick={() => c.sortBy(p.sortKey!)}>
      {p.displayName}{on && <span aria-hidden="true"> {p.dir === "asc" ? "▲" : "▼"}</span>}
    </button>
  );
};
const stop = (e: React.MouseEvent) => e.stopPropagation();
const Cell = (p: { href: string; children: React.ReactNode; title?: string }) => <Link href={p.href} className="al-cell-link" title={p.title} onClick={stop}>{p.children}</Link>;

/** The one next step an admin should take on a session, as a link to where it is done. */
function primaryAction(r: SessionRow, c: Ctx): { label: string; href: string; title: string } | null {
  const need = needsYou(r, c.now)[0];
  if (need === "no-participants") return { label: "Add people", href: `${c.session(r)}#participants`, title: "Add the people to invite" };
  if (need === "confirm-mailing") return { label: "Review mailing", href: `${c.session(r)}#participants`, title: "Read the written mailing and confirm it" };
  if (need === "not-applied") return { label: "Apply results", href: c.results(r), title: "Look at the results and apply them to the Stack Rank" };
  if (r.status !== "draft") return { label: "Results", href: c.results(r), title: r.status === "open" ? "Provisional results" : "The results" };
  return null;
}

const NameCell = (p: CustomCellRendererProps<SessionRow>) => { const c = p.context as Ctx; return <Link href={c.link(p.data!)} className="al-name" title={p.data!.name} onClick={stop}>{p.data!.name}</Link>; };
const StatusCell = (p: CustomCellRendererProps<SessionRow>) => <span className={`pill tone-${STATE_TONE[p.data!.status]}`}>{STATE_LABEL[p.data!.status]}</span>;
const NeedsCell = (p: CustomCellRendererProps<SessionRow>) => {
  const n = needsYou(p.data!, (p.context as Ctx).now);
  return <span className="grid-flags" title={n.map((x) => NEED_LABEL[x]).join("\n")}>{n.map((x) => <span key={x} className="pill tone-risk">⚑ {NEED_LABEL[x]}</span>)}</span>;
};
const ActionsCell = (p: CustomCellRendererProps<SessionRow>) => {
  const r = p.data!, c = p.context as Ctx;
  const a = primaryAction(r, c), next = NEXT_STATE[r.status];
  return (
    <span className="grid-flags">
      {a && <Link href={a.href} className="chg-act" title={a.title} onClick={stop}>{a.label}<span className="chg-act-arrow" aria-hidden="true">→</span></Link>}
      {next && <button type="button" className="chg-act chg-act-requested" title={next.confirm} aria-label={`${next.label}: ${r.name}`} onClick={(e) => { e.stopPropagation(); c.step(r); }}>{r.status === "draft" ? "Open" : r.status === "open" ? "Close" : "Archive"}</button>}
    </span>
  );
};
const QuarterCell = (p: CustomCellRendererProps<SessionRow>) => {
  const r = p.data!;
  return <>{quarterText(r)}{r.quarters.length > 1 && <span className="muted" title={`Also ${r.quarters.filter((q) => q !== r.quarter).join(", ")}`}> +{r.quarters.length - 1}<span className="sr-only"> more: {r.quarters.filter((q) => q !== r.quarter).join(", ")}</span></span>}</>;
};
const closedText = (r: SessionRow) => (r.closedAt ? day(r.closedAt) : r.closesAt ? `${day(r.closesAt)} (planned)` : "By hand");
const appliedText = (r: SessionRow) => { const a = appliedState(r); return a === "applied" ? `Applied ${day(r.stats!.applied!.at)} (${r.stats!.applied!.moved} moved)` : a === "undone" ? "Undone" : a === "not-applied" ? "Not applied" : "–"; };
const pct = (r: SessionRow) => { const p = participation(r.stats); return p === null ? "–" : `${p}%`; };
const head = (name: string, sort: SortKey | null, more: Partial<ColDef<SessionRow>> = {}): ColDef<SessionRow> => ({ headerName: name, headerComponent: SortHeader, headerComponentParams: { sortKey: sort }, ...more });
/** A count that goes deeper: a link to the page that explains it. */
const linked = (to: (r: SessionRow, c: Ctx) => string, value: (r: SessionRow) => string | number) => {
  const LinkedCell = (p: CustomCellRendererProps<SessionRow>) => <Cell href={to(p.data!, p.context as Ctx)}>{value(p.data!)}</Cell>;
  return LinkedCell;
};

const ContestedCell = (p: CustomCellRendererProps<SessionRow>) => (p.data!.contested === null ? <>–</> : <Cell href={(p.context as Ctx).results(p.data!)} title="Initiatives the groups disagreed on">{p.data!.contested}</Cell>);

/** Every column of the grid in the default order. The Actions column and the admin-only values are left out for people who are not admins. */
const COLUMNS: Col[] = [
  { id: "name", name: "Session", text: (r) => r.name, def: head("Session", "name", { flex: 2, minWidth: 210, cellRenderer: NameCell }) },
  { id: "status", name: "Status", text: (r) => STATE_LABEL[r.status], def: head("Status", "status", { width: 110, cellRenderer: StatusCell }) },
  { id: "needs", name: "Needs you", admin: true, text: (r, c) => needsYou(r, c.now).map((n) => NEED_LABEL[n]).join("; "), def: head("Needs you", null, { flex: 2, minWidth: 230, cellRenderer: NeedsCell, suppressNavigable: true }) },
  { id: "actions", name: "Actions", admin: true, def: head("Actions", null, { width: 220, cellRenderer: ActionsCell, suppressNavigable: true }) },
  { id: "method", name: "Method", text: (r) => methodName(r.method), def: head("Method", null, { width: 150, valueGetter: (p) => methodName(p.data!.method) }) },
  { id: "created", name: "Created", text: (r) => day(r.createdAt), def: head("Created", "created", { width: 120, valueGetter: (p) => day(p.data!.createdAt) }) },
  { id: "closed", name: "Closes or closed", text: closedText, def: head("Closes or closed", "closed", { width: 160, valueGetter: (p) => closedText(p.data!) }) },
  { id: "quarter", name: "Planned quarter", text: (r) => quarterText(r), def: head("Planned quarter", "quarter", { width: 150, cellRenderer: QuarterCell }) },
  { id: "initiatives", name: "Initiatives", text: (r) => r.initiatives, def: head("Initiatives", "initiatives", { width: 110, cellRenderer: linked((r, c) => c.session(r), (r) => r.initiatives), type: "rightAligned" }) },
  { id: "invited", name: "Invited", admin: true, text: (r) => r.stats?.invited ?? null, def: head("Invited", "invited", { width: 90, cellRenderer: linked((r, c) => `${c.session(r)}#participants`, (r) => r.stats?.invited ?? "–"), type: "rightAligned" }) },
  { id: "voted", name: "Voted", admin: true, text: (r) => r.stats?.voted ?? null, def: head("Voted", "voted", { width: 80, cellRenderer: linked((r, c) => `${c.session(r)}#participants`, (r) => r.stats?.voted ?? "–"), type: "rightAligned" }) },
  { id: "participation", name: "Participation", admin: true, text: pct, def: head("Participation", "participation", { width: 130, valueGetter: (p) => pct(p.data!), type: "rightAligned" }) },
  { id: "contested", name: "Contested", text: (r) => r.contested, def: head("Contested", "contested", { width: 110, cellRenderer: ContestedCell, type: "rightAligned" }) },
  { id: "applied", name: "Applied to Stack Rank", admin: true, text: appliedText, def: head("Applied to Stack Rank", "applied", { width: 220, valueGetter: (p) => appliedText(p.data!) }) },
  { id: "by", name: "Created by", admin: true, text: (r, c) => (r.createdBy ? c.people[r.createdBy] ?? "" : ""), def: head("Created by", null, { width: 230, valueGetter: (p) => ((p.context as Ctx).people[p.data!.createdBy ?? ""] ?? "–"), tooltipValueGetter: (p) => (p.context as Ctx).people[p.data?.createdBy ?? ""] ?? "" }) },
];

type Saved = { columns: string[]; by: AlignGroupBy | null; then: AlignGroupBy | null };
const STORE = "pv.alignment.view.v1";
/** What a viewer chose for columns and grouping is remembered in the browser (a convenience, not shared); storage may be unavailable, so every access is guarded. */
const readSaved = (allowed: string[]): Saved => {
  const fallback: Saved = { columns: allowed, by: null, then: null };
  try {
    const v = JSON.parse(window.localStorage.getItem(STORE) ?? "null") as Partial<Saved> | null;
    if (!v) return fallback;
    const cols = (v.columns ?? []).filter((c) => allowed.includes(c));
    const ok = (g: unknown): g is AlignGroupBy | null => g === null || ALIGN_GROUP_BYS.some((x) => x.id === g);
    return { columns: cols.length > 0 ? cols : allowed, by: ok(v.by) ? v.by : null, then: ok(v.then) ? v.then : null };
  } catch { return fallback; }
};
const writeSaved = (s: Saved) => { try { window.localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* blocked storage: the choice is just not remembered */ } };

const isFullWidthRow = (p: { rowNode: { data?: unknown } }) => isGroup(p.rowNode.data);
const getRowId = (p: { data: { id: string } }) => p.data.id;

/** Confirm dialog for one step forward (open, close, archive) from the grid. */
function StepDialog({ row, setState, onClose, onDone }: { row: SessionRow; setState: SetSessionState; onClose: () => void; onDone: (text: string) => void }) {
  const titleId = useId();
  const next = NEXT_STATE[row.status]!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setError(null);
    const r = await setState(row.id, next.to);
    if (!r.ok) { setBusy(false); setError(r.error); return; }
    onDone(`${row.name} is now ${STATE_LABEL[next.to].toLowerCase()}.`);
  };
  return (
    <div className="dialog-backdrop" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{next.label}: {row.name}</h2>
        <p>{next.confirm}</p>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy} autoFocus onClick={() => void go()}>{busy ? "Working…" : next.label}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * The Alignment tab (issues #392 and #586): every alignment session of the workspace, past and present, on the shared AG Grid with the action bar of the Roadmap grid
 * (Filter, Columns, Group by, Search), the stats cards and "needs you" chips of an admin on top, an Actions column and links that go deeper (the session, its people,
 * its results). Everyone else sees only closed sessions that allow results, and none of the admin-only values (the database decides which rows they get, and `stats` is null
 * for them). Totals only: nothing here is about a person, and nothing is grouped by one (rule 8).
 */
export function AlignmentList({ rows, isAdmin, people, initiatives, create, setState, onCreated, now }: {
  rows: SessionRow[]; isAdmin: boolean; people: Record<string, string>; initiatives: Initiative[]; create: CreateSession; setState?: SetSessionState; onCreated?: (id: string) => void; now?: Date;
}) {
  const router = useRouter();
  const clock = useMemo(() => now ?? new Date(), [now]);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "created", dir: "desc" });
  const [dialog, setDialog] = useState(false);
  const [stepFor, setStepFor] = useState<SessionRow | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const columns = useMemo(() => COLUMNS.filter((c) => !c.admin || isAdmin), [isAdmin]);
  const allowed = useMemo(() => columns.map((c) => c.id), [columns]);
  const [saved, setSaved] = useState<Saved>({ columns: allowed, by: null, then: null });
  // after mount, not in the initial state: the page is rendered on the server first, and the saved choice lives only in the browser
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setSaved(readSaved(allowed)); }, [allowed]);
  const change = (s: Partial<Saved>) => setSaved((cur) => { const n = { ...cur, ...s }; writeSaved(n); return n; });
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  const shown = useMemo(() => sortRows(filterRows(rows, filters, clock), sort.key, sort.dir), [rows, filters, clock, sort]);
  const totals = useMemo(() => summarize(shown), [shown]);
  const counts = useMemo(() => needCounts(rows.filter((r) => r.status !== "archived" || filters.showArchived), clock), [rows, filters.showArchived, clock]);
  const quarters = useMemo(() => quarterOptions(rows), [rows]);
  const creators = useMemo(() => [...new Set(rows.map((r) => r.createdBy).filter((x): x is string => !!x))], [rows]);
  const filtered = filterCount(filters) > 0 || filters.q.trim() !== "";
  const gridRows = useMemo(() => groupSessionRows(shown, saved.by, saved.then, collapsed, clock), [shown, saved.by, saved.then, collapsed, clock]);
  const groupKeys = useMemo(() => groupSessionRows(shown, saved.by, saved.then, new Set(), clock).filter(isGroup).map((g) => g.key), [shown, saved.by, saved.then, clock]);

  const toggle = useCallback((key: string) => setCollapsed((s) => { const n = new Set(s); if (!n.delete(key)) n.add(key); return n; }), []);
  const sortBy = useCallback((k: SortKey) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: k === "name" ? "asc" : "desc" })), []);
  const session = useCallback((r: SessionRow) => `/alignment/${r.id}`, []);
  const results = useCallback((r: SessionRow) => `/alignment/${r.id}/results`, []);
  const link = useCallback((r: SessionRow) => (isAdmin ? session(r) : results(r)), [isAdmin, session, results]);
  const ctx = useMemo<Ctx>(() => ({ toggleGroup: toggle, link, results, session, isAdmin, now: clock, people, sort, sortBy, step: setStepFor }), [toggle, link, results, session, isAdmin, clock, people, sort, sortBy]);

  // the sort is part of the header's parameters so the header buttons say which way a column is sorted (the grid redraws a header only when its parameters change)
  const defs = useMemo<ColDef<SessionRow>[]>(() => saved.columns.map((id) => {
    const d = columns.find((c) => c.id === id)!.def;
    const key = (d.headerComponentParams as { sortKey: SortKey | null }).sortKey;
    return { colId: id, ...d, headerComponentParams: { sortKey: key, dir: key && sort.key === key ? sort.dir : null } };
  }), [saved.columns, columns, sort]);
  const onColumnMoved = useCallback((e: ColumnMovedEvent) => {
    if (!e.finished || e.source === "api") return;
    const ids = e.api.getColumnState().map((s) => s.colId);
    if (ids.length === saved.columns.length && ids.some((id, i) => id !== saved.columns[i])) change({ columns: ids });
  }, [saved.columns]);
  /** A click on the row (not on a link or a button in it) goes to the session. */
  const onRowClicked = useCallback((e: RowClickedEvent) => {
    const t = e.event?.target as HTMLElement | null;
    if (!e.data || isGroup(e.data) || t?.closest("a,button")) return;
    router.push(link(e.data as SessionRow));
  }, [router, link]);

  const refresh = () => { setRefreshing(true); router.refresh(); window.setTimeout(() => setRefreshing(false), 600); };
  const exportCsv = () => {
    const cols = columns.filter((c) => saved.columns.includes(c.id) && c.text);
    const csv = toCsv(cols.map((c) => c.name), shown.map((r) => cols.map((c) => c.text!(r, ctx))));
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = "alignment-sessions.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page-wide alignment-list">
      <div className="page-head">
        <h1>Alignment</h1>
        {isAdmin && <button type="button" className="btn btn-primary" onClick={() => setDialog(true)}>New session</button>}
      </div>
      <p className="muted">
        Ask a group of people to rank initiatives: the top five with duels, 100 coins, or ICE sliders. Participants need no account and see only anonymous results.
        {isAdmin ? " You can also select initiatives in the roadmap and press Start alignment session…." : " You see the sessions that have closed and allow results."}
      </p>

      {isAdmin && rows.length > 0 && (
        <>
          <dl className="al-stats" aria-label="Totals for the sessions shown">
            <div><dt>Sessions</dt><dd>{totals.sessions}</dd></div>
            <div><dt>People invited</dt><dd>{totals.invited}</dd></div>
            <div><dt>Participation</dt><dd>{totals.participation === null ? "–" : `${totals.participation}%`}</dd></div>
            <div><dt>Initiatives ranked</dt><dd>{totals.initiativesRanked}</dd></div>
            <div><dt>Results applied</dt><dd>{totals.applied}</dd></div>
          </dl>
          <div className="al-needs" role="group" aria-label="Needs you">
            {NEEDS.some((n) => counts[n] > 0) ? NEEDS.filter((n) => counts[n] > 0).map((n) => (
              <button key={n} type="button" className={`al-chip${filters.need === n ? " is-on" : ""}`} aria-pressed={filters.need === n} onClick={() => set("need", filters.need === n ? "" : n)}>
                {NEED_LABEL[n]} <strong>{counts[n]}</strong>
              </button>
            )) : <span className="muted">Nothing needs you right now.</span>}
          </div>
        </>
      )}

      {rows.length === 0 ? (
        <p role="status">{isAdmin ? "No alignment sessions yet. Press New session to start one." : "No results to show yet. A session appears here when it has closed and allows results."}</p>
      ) : (
        <>
          <AlignmentBar
            filters={filters} onFilters={setFilters} isAdmin={isAdmin} quarters={quarters} creators={creators} people={people} matching={shown.length} total={rows.filter((r) => r.status !== "archived" || filters.showArchived).length}
            allColumns={columns.map(({ id, name }) => ({ id, name }))} columns={saved.columns} defaultColumns={allowed} onColumns={(ids) => change({ columns: ids })}
            by={saved.by} then={saved.then} onGroup={(by, then) => { setCollapsed(new Set()); change({ by, then }); }}
            groupKeys={groupKeys} collapsed={collapsed} onCollapse={setCollapsed} onRefresh={refresh} onExport={exportCsv} refreshing={refreshing}
          />
          <AlignmentChips filters={filters} people={people} onChange={setFilters} />
          {message && <p role="status" className="notice">{message}</p>}
          <p className="muted" role="status">{shown.length} {shown.length === 1 ? "session" : "sessions"}{filtered ? " match" : ""}.</p>
          {shown.length === 0 ? <p>No session matches. <button type="button" className="link-button" onClick={() => setFilters(NO_FILTERS)}>Clear the filters</button> to see them all.</p> : (
            <div className="al-grid" data-testid="alignment-grid">
              <AgGridReact<SessionRow>
                theme={GRID_THEME} rowData={gridRows as SessionRow[]} columnDefs={defs} getRowId={getRowId} context={ctx} onColumnMoved={onColumnMoved} onRowClicked={onRowClicked}
                isFullWidthRow={isFullWidthRow} fullWidthCellRenderer={GroupRowRenderer as never} getRowClass={(p) => (p.data && !isGroup(p.data) ? "al-row" : undefined)}
                domLayout="autoHeight" rowHeight={40} defaultColDef={{ ...DEFAULT_COL_DEF, suppressHeaderMenuButton: true }} tooltipShowDelay={500} suppressColumnVirtualisation
              />
            </div>
          )}
        </>
      )}
      {dialog && <NewSessionDialog initiatives={initiatives} create={create} onClose={() => setDialog(false)} onCreated={(id) => (onCreated ? onCreated(id) : router.push(`/alignment/${id}`))} />}
      {stepFor && setState && <StepDialog row={stepFor} setState={setState} onClose={() => setStepFor(null)} onDone={(t) => { setStepFor(null); setMessage(t); router.refresh(); }} />}
    </div>
  );
}
