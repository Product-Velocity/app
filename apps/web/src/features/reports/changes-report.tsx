"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import type { ColDef, ColumnMovedEvent } from "ag-grid-community";
import {
  CHANGE_PERIODS, NO_CHANGE_FILTERS, buildChangeRows, changeFlags, changePeriod, changeTypeLabel, filterChangeRows, groupChangeRows, isChangeHeader, isOpenableUrl,
  type ChangeFlag, type ChangeFilters, type ChangeGridRow, type ChangeGroupBy, type ChangePeriod, type ChangeRowData, type FeedRow, type ItemInfo, type JiraStatusRecord, type TrackerRef,
} from "@pv/domain";
import { DEFAULT_COL_DEF, GRID_THEME, GroupRowRenderer } from "../portfolio/grid-kit";
import { ChangeFilterChips, ChangesBar, type ChangeColumn } from "./changes-bar";
import type { ReportEnv } from "./report-env";

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
type Ctx = { toggleGroup: (key: string) => void; open: (itemId: string) => void };

const FlagPills = ({ flags }: { flags: readonly ChangeFlag[] }) => <>{flags.map((f) => <span key={f.kind} className="pill tone-risk chg-flag" title={f.text}>⚑ {f.label}</span>)}</>;
const TypeCell = (p: CustomCellRendererProps<ChangeRowData>) => <span className={`pill chg-type chg-type-${p.data!.type}`}>{changeTypeLabel(p.data!.type)}{p.data!.tracker ? ` (${p.data!.tracker})` : ""}</span>;
const ChangeCell = (p: CustomCellRendererProps<ChangeRowData>) => {
  const d = p.data!, b = d.alsoBuild;
  return (
    <span className="chg-change">
      <span>{d.from ?? "empty"} <span aria-label="to">→</span> <span className={`pill tone-${d.tone}`}>{d.to ?? "empty"}</span></span>
      {b && <span className="chg-also"><span className="muted">Build Status:</span> {b.from ?? "empty"} <span aria-label="to">→</span> <span className={`pill tone-${b.tone}`}>{b.to ?? "empty"}</span></span>}
    </span>
  );
};
const InitiativeCell = (p: CustomCellRendererProps<ChangeRowData>) => {
  const d = p.data!;
  return <button type="button" className="link-button" title={d.name} onClick={() => (p.context as Ctx).open(d.itemId)}><strong>{d.code}</strong> {d.name}</button>;
};
/** The Jira epic or GitHub issue behind a change: its id (a link that opens it in the tracker), its name and where it is. */
const IssueCell = (p: CustomCellRendererProps<ChangeRowData>) => {
  const i = p.data!.issue;
  if (!i) return null;
  return (
    <span className="chg-issue" title={`${i.tracker} ${i.key}${i.title ? `: ${i.title}` : ""}`}>
      {isOpenableUrl(i.url) ? <a href={i.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${i.key} in ${i.tracker} (new tab)`}><strong>{i.key}</strong> ↗</a> : <strong>{i.key}</strong>}
      {i.title && <span className="muted"> {i.title}</span>}
      <span className="muted"> · {i.tracker}</span>
    </span>
  );
};
/** In a row: the first flag and how many more; all of them are in the tooltip and on the initiative's group header. */
const FlagCell = (p: CustomCellRendererProps<ChangeRowData>) => {
  const f = p.data!.flags;
  if (f.length === 0) return null;
  return <><FlagPills flags={f.slice(0, 1)} />{f.length > 1 && <span className="pill tone-neutral" title={f.map((x) => `${x.label}: ${x.text}`).join("\n")}>+{f.length - 1} more</span>}</>;
};

/** Every column of the change log, in the default order. "Source" (Product Velocity, Jira or GitHub) sits in front of "Source type" (UI, API, Claude MCP, GitHub webhook, import, system). */
const COLUMNS: (ChangeColumn & { def: ColDef<ChangeRowData> })[] = [
  { id: "at", name: "Registered", def: { headerName: "Registered", width: 160, valueGetter: (p) => p.data?.at, valueFormatter: (p) => (p.value ? when(String(p.value)) : ""), cellClass: "chg-time" } },
  { id: "initiative", name: "Initiative", def: { headerName: "Initiative", flex: 2, minWidth: 220, cellRenderer: InitiativeCell } },
  { id: "type", name: "Change type", def: { headerName: "Change type", width: 170, cellRenderer: TypeCell } },
  { id: "change", name: "Change", def: { headerName: "Change", flex: 2, minWidth: 240, cellRenderer: ChangeCell } },
  { id: "issue", name: "Tracker issue", def: { headerName: "Tracker issue", flex: 2, minWidth: 220, cellRenderer: IssueCell } },
  { id: "source", name: "Source", def: { headerName: "Source", width: 150, valueGetter: (p) => p.data?.source } },
  { id: "sourceType", name: "Source type", def: { headerName: "Source type", width: 140, valueGetter: (p) => p.data?.sourceType } },
  { id: "by", name: "By", def: { headerName: "By", width: 230, valueGetter: (p) => p.data?.by, tooltipValueGetter: (p) => p.data?.by } },
  { id: "jiraUser", name: "Jira user", def: { headerName: "Jira user", width: 180, valueGetter: (p) => p.data?.jiraUser ?? "", tooltipValueGetter: (p) => (p.data?.jiraUser ? `${p.data.jiraUser} moved the Jira issue to this status (from Jira's own history)` : "") } },
  { id: "flags", name: "Follow up", def: { headerName: "Follow up", flex: 2, minWidth: 260, cellRenderer: FlagCell, cellClass: "chg-flags" } },
];
const ALL_COLUMNS = COLUMNS.map(({ id, name }) => ({ id, name }));
const DEFAULT_COLUMNS = COLUMNS.map((c) => c.id);

const isFullWidthRow = (p: { rowNode: { data?: unknown } }) => isChangeHeader(p.rowNode.data);
const getRowId = (p: { data: ChangeGridRow }) => p.data.id;
const getRowHeight = (p: { data?: ChangeGridRow }) => (p.data && !isChangeHeader(p.data) && p.data.alsoBuild ? 58 : undefined); // two lines: the linked-issue status and the Build Status that went with it
const getRowClass = (p: { data?: ChangeGridRow }) => (p.data && !isChangeHeader(p.data) ? `chg-row chg-row-${p.data.type}` : undefined);

type Saved = { columns: string[]; by: ChangeGroupBy | null; then: ChangeGroupBy | null };
const STORE = "pv.changes.view.v2"; // v2: the Jira user column (a saved list of columns from v1 would not show it)
/** What a viewer chose for columns and grouping is remembered in the browser (a convenience, not shared); it may be unavailable, so every access is guarded. */
const readSaved = (): Saved => {
  const fallback: Saved = { columns: DEFAULT_COLUMNS, by: "initiative", then: null };
  try {
    const v = JSON.parse(window.localStorage.getItem(STORE) ?? "null") as Partial<Saved> | null;
    if (!v) return fallback;
    const cols = (v.columns ?? []).filter((c) => DEFAULT_COLUMNS.includes(c));
    const ok = (g: unknown): g is ChangeGroupBy | null => g === null || ["initiative", "type", "source", "sourceType", "day"].includes(String(g));
    return { columns: cols.length > 0 ? cols : DEFAULT_COLUMNS, by: ok(v.by) ? v.by : "initiative", then: ok(v.then) ? v.then : null };
  } catch { return fallback; }
};
const writeSaved = (s: Saved) => { try { window.localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* private window or blocked storage: the choice just is not remembered */ } };

/**
 * Changes: which initiatives changed in a period and what changed (issue #472), on an AG Grid built on the Roadmap grid's parts, with the Roadmap's action bar (Filter,
 * Columns, Group by, Search), colour by type of change and by the value it ended on, and the flags to follow up. Follows the filters of the Reports tab. The time is when
 * Product Velocity registered the change; "Source" says where the value came from (Product Velocity, Jira or GitHub) and "Source type" how it arrived. Actors are named on
 * a row; for a tracker value the person only ran the Sync. Nothing is counted or grouped per person (rule 8). Every colour comes with a word.
 */
export function ChangesReport({ env, load, loadIssues, loadJiraUsers, onOpen }: { env: ReportEnv; load?: (from: Date, to: Date) => Promise<FeedRow[]>; loadIssues?: (itemIds: string[]) => Promise<Map<string, TrackerRef>>; /** The Jira users who moved the issues to a status, from Jira's own history. */ loadJiraUsers?: (issueKeys: string[], from: Date, to: Date) => Promise<JiraStatusRecord[]>; onOpen: (id: string) => void }) {
  const { rows, lookups, controller } = env;
  const [period, setPeriod] = useState<ChangePeriod>("today");
  const [filters, setFilters] = useState<ChangeFilters>(NO_CHANGE_FILTERS);
  const [saved, setSaved] = useState<Saved>(readSaved); // the component mounts only in the browser, after the roadmap has loaded
  const change = (s: Partial<Saved>) => setSaved((cur) => { const n = { ...cur, ...s }; writeSaved(n); return n; });
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [loaded, setLoaded] = useState<{ key: string; rows: FeedRow[] } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    if (!load) return;
    const { from, to } = changePeriod(period, new Date());
    load(from, to).then((r) => { if (live) { setLoaded({ key: `${period}:${reload}`, rows: r }); setFailed(null); } }, (e: unknown) => { if (live) setFailed(e instanceof Error ? e.message : "Could not read the changes."); });
    return () => { live = false; };
  }, [load, period, reload]);

  const feed = loaded && loaded.key === `${period}:${reload}` ? loaded.rows : null; // null while a new period is loading
  const items = useMemo(() => new Map<string, ItemInfo>(rows.map((r) => [r.id, { code: String(r.item_code ?? ""), name: String(r.initiative_name ?? ""), rank: r.stack_rank }])), [rows]);
  /** The flags to follow up: the Needs attention reasons that can be worked out from the grid's rows, and the two this report adds for initiatives with no phase. */
  const flags = useMemo(() => changeFlags(rows, controller.todayDate()), [rows, controller]);
  const changedIds = useMemo(() => [...new Set((feed ?? []).map((r) => r.item_id).filter((id) => items.has(id)))].sort().join(","), [feed, items]);
  /** The tracker issue of each initiative that changed. A failure leaves the column empty; it is not worth stopping the report. */
  const [issues, setIssues] = useState<ReadonlyMap<string, TrackerRef>>(new Map());
  useEffect(() => {
    let live = true;
    if (!loadIssues || changedIds === "") return;
    loadIssues(changedIds.split(",")).then((m) => { if (live) setIssues(m); }, () => { if (live) setIssues(new Map()); });
    return () => { live = false; };
  }, [loadIssues, changedIds]);
  /** The Jira user behind each Jira move: a name on a row, read once per list of Jira issues and period. A failure leaves the column empty. */
  const [jiraUsers, setJiraUsers] = useState<readonly JiraStatusRecord[]>([]);
  const jiraKeys = useMemo(() => [...new Set([...issues.values()].filter((i) => i.tracker === "Jira").map((i) => i.key))].sort().join(","), [issues]);
  useEffect(() => {
    let live = true;
    if (!loadJiraUsers || jiraKeys === "") return;
    const { from, to } = changePeriod(period, new Date());
    loadJiraUsers(jiraKeys.split(","), from, to).then((r) => { if (live) setJiraUsers(r); }, () => { if (live) setJiraUsers([]); });
    return () => { live = false; };
  }, [loadJiraUsers, jiraKeys, period]);
  const who = useCallback((id: string | null) => (id ? lookups.members.find((m) => m.user_id === id)?.email ?? "someone" : "the system"), [lookups.members]);

  const allRows = useMemo(() => buildChangeRows(feed ?? [], items, { flags, issues, nameOf: who, jiraUsers }), [feed, items, flags, issues, who, jiraUsers]);
  const filtered = useMemo(() => filterChangeRows(allRows, filters), [allRows, filters]);
  const gridRows = useMemo(() => groupChangeRows(filtered, saved.by, saved.then, collapsed), [filtered, saved.by, saved.then, collapsed]);
  const initiatives = useMemo(() => new Set(filtered.map((r) => r.itemId)), [filtered]);
  const flagged = useMemo(() => [...initiatives].filter((id) => (flags.get(id) ?? []).length > 0).length, [initiatives, flags]);

  const toggle = useCallback((key: string) => setCollapsed((s) => { const n = new Set(s); if (!n.delete(key)) n.add(key); return n; }), []);
  const context = useMemo<Ctx>(() => ({ toggleGroup: toggle, open: onOpen }), [toggle, onOpen]);
  const columnDefs = useMemo<ColDef<ChangeGridRow>[]>(() => saved.columns.map((id) => ({ colId: id, ...COLUMNS.find((c) => c.id === id)!.def })) as ColDef<ChangeGridRow>[], [saved.columns]);
  /** A column dragged by its header in the grid is the new order, so the Columns panel and the grid agree. */
  const onColumnMoved = useCallback((e: ColumnMovedEvent) => {
    if (!e.finished || e.source === "api") return;
    const ids = e.api.getColumnState().map((s) => s.colId);
    if (ids.length === saved.columns.length && ids.some((id, i) => id !== saved.columns[i])) change({ columns: ids });
  }, [saved.columns]);

  const { from, to } = changePeriod(period, new Date());
  const range = `${from.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} to ${new Date(to.getTime() - 1).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  if (failed) return <div role="alert" className="error">Could not load the changes: {failed} <button type="button" className="link-button" onClick={() => setReload((n) => n + 1)}>Try again</button></div>;
  const shownCount = filtered.length;

  return (
    <section className="rp-card rp-wide" aria-label="Changes">
      <h2 className="rp-title">Changes</h2>
      <p className="rp-note">What changed on the initiatives that match the filters above, {range}. Times are when Product Velocity registered the change, in your time zone. Source is where the new value came from (Product Velocity, Jira or GitHub); Source type is how it reached Product Velocity. Colour shows the type of change (left edge and label) and the value it ended on (green good, amber at risk, red bad, blue active, grey neutral); the words always say the same. A flag ⚑ is a reason to follow up; it is a suggestion, nothing changes by itself. A closed linked issue sets Build Status, never the initiative&apos;s own status; for those values the person on the row only ran the Sync. Jira statuses are grey because Jira teams name them freely.</p>
      <div className="view-chips" role="group" aria-label="Period">
        {CHANGE_PERIODS.map((p) => <button key={p.id} type="button" className={period === p.id ? "view-chip view-chip-on" : "view-chip"} aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}>{p.label}</button>)}
      </div>
      <ChangesBar
        filters={filters} onFilters={setFilters} rows={allRows} matching={shownCount}
        allColumns={ALL_COLUMNS} columns={saved.columns} defaultColumns={DEFAULT_COLUMNS} onColumns={(ids) => change({ columns: ids })}
        by={saved.by} then={saved.then} onGroup={(by, then) => { setCollapsed(new Set()); change({ by, then }); }}
      />
      <ChangeFilterChips filters={filters} rows={allRows} onChange={setFilters} />

      {!load ? <p role="status" className="muted">The changes are not available here.</p>
        : feed === null ? <p role="status" className="muted">Loading the changes…</p>
        : gridRows.length === 0 ? <p className="rp-empty" role="status">{allRows.length > 0 ? "No change matches the filters or the search" : "No changes in this period for the current filters"}</p>
        : (
          <>
            <p className="muted" role="status">{plural(initiatives.size, "initiative", "initiatives")} changed{flagged > 0 ? `, ${flagged.toLocaleString("en-GB")} to follow up` : ""}{feed.length >= 5000 ? " (showing the latest 5,000 changes)" : ""}.</p>
            <div className="grid-wrap chg-grid" data-testid="changes-grid">
              <AgGridReact<ChangeGridRow>
                theme={GRID_THEME} rowData={gridRows} columnDefs={columnDefs} getRowId={getRowId} context={context} onColumnMoved={onColumnMoved}
                isFullWidthRow={isFullWidthRow} fullWidthCellRenderer={GroupRowRenderer as never} getRowClass={getRowClass} getRowHeight={getRowHeight}
                defaultColDef={{ ...DEFAULT_COL_DEF, suppressHeaderMenuButton: true }} tooltipShowDelay={500}
              />
            </div>
            <p className="grid-foot">{shownCount.toLocaleString("en-GB")}{shownCount === allRows.length ? "" : ` of ${allRows.length.toLocaleString("en-GB")}`} changes · {saved.by || saved.then ? "Grouped, newest first inside each group" : "Not grouped, newest first"} · The time is when Product Velocity registered the change</p>
          </>
        )}
    </section>
  );
}
