"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FlagControl, actionClass } from "@/components/flag-controls";
import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import type { ColDef, ColumnMovedEvent } from "ag-grid-community";
import {
  CHANGE_PERIODS, actionsOfFlags, NO_CHANGE_FILTERS, buildChangeRows, changeFlags, changePeriod, changeTypeLabel, filterChangeRows, groupChangeRows, isChangeHeader, isOpenableUrl, primaryRowIds, resolveFlagAction, openGateOf,
  type ChangeFlag, type OutcomeReview, type ChangeFilters, type GateId, type ChangeGridRow, type ChangeGroupBy, type ChangePeriod, type ChangeRowData, type FeedRow, type ItemInfo, type JiraCategory, type JiraStatusRecord, type TrackerRef,
} from "@pv/domain";
import { DEFAULT_COL_DEF, GRID_THEME, GroupRowRenderer } from "../portfolio/grid-kit";
import { useFillHeight } from "@/lib/use-fill-height";
import { ChangeFilterChips, ChangesBar, type ChangeColumn } from "./changes-bar";
import { RequestGateDialog } from "../gates/gate-dialogs";
import type { GateSource } from "../gates/gate-source";
import type { ReportEnv } from "./report-env";

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
type Ctx = {
  toggleGroup: (key: string) => void; open: (itemId: string) => void;
  /** The ids of the rows that carry the buttons (the newest row of each initiative), what the person may do, and the button that is working. */
  primary: ReadonlySet<string>; canAct: boolean; busy: string | null; act: (itemId: string, flag: ChangeFlag) => void; phaseOf: (itemId: string) => unknown; openGateOf: (itemId: string) => GateId | null;
};

const FlagPills = ({ flags }: { flags: readonly ChangeFlag[] }) => <>{flags.map((f) => <span key={f.kind} className="pill tone-risk chg-flag" title={f.text}>⚑ {f.label}</span>)}</>;
const TypeCell = (p: CustomCellRendererProps<ChangeRowData>) => <span className={`pill chg-type chg-type-${p.data!.type}`}>{changeTypeLabel(p.data!.type)}{p.data!.tracker ? ` (${p.data!.tracker})` : ""}</span>;
const ChangeCell = (p: CustomCellRendererProps<ChangeRowData>) => {
  const d = p.data!, b = d.alsoBuild;
  return (
    <span className="chg-change">
      <span>{d.from ? <span className={`pill tone-${d.fromTone}`}>{d.from}</span> : "empty"} <span aria-label="to">→</span> <span className={`pill tone-${d.tone}`}>{d.to ?? "empty"}</span></span>
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
/**
 * Flags and Actions: the same two columns as the main grid. On the newest row of an initiative, its flags as pills (the tooltip has every reason) and, in the next
 * column, the button for what to do about each (Move to Test, or Request gate when the move passes a decision gate). A button changes nothing beyond that one move, made
 * as the signed-in person (rule 3 is about Claude, which is not involved). Other rows of the initiative stay quiet.
 */
const FlagsCell = (p: CustomCellRendererProps<ChangeRowData>) => {
  const d = p.data!, ctx = p.context as Ctx;
  if (d.flags.length === 0 || !ctx.primary.has(d.id)) return null;
  const labels = [...new Set(d.flags.map((f) => f.label))];
  const phase = ctx.phaseOf(d.itemId), openGate = ctx.openGateOf(d.itemId);
  return (
    <span className="grid-flags" title={d.flags.map((f) => `${f.label}: ${f.text}`).join("\n")}>
      {labels.map((l) => {
        // a pill whose flag has an action does what that action's button does
        const flag = ctx.canAct ? d.flags.find((f) => f.label === l && f.action) : undefined;
        const a = flag?.action ? resolveFlagAction(flag.action, phase, openGate) : null;
        if (!flag || !a) return <span key={l} className="pill tone-risk chg-flag">⚑ {l}</span>;
        return <FlagControl key={l} a={a} className="pill tone-risk chg-flag chg-flag-act" busy={ctx.busy === `${d.itemId}:${flag.kind}`} onRun={() => ctx.act(d.itemId, flag)}>⚑ {l}</FlagControl>;
      })}
    </span>
  );
};
const ActionsCell = (p: CustomCellRendererProps<ChangeRowData>) => {
  const d = p.data!, ctx = p.context as Ctx;
  if (d.flags.length === 0 || !ctx.primary.has(d.id)) return null;
  const actions = actionsOfFlags(d.flags, ctx.phaseOf(d.itemId), ctx.canAct, ctx.openGateOf(d.itemId));
  if (actions.length === 0) return null;
  return (
    <span className="grid-flags">
      {actions.map(({ flag, resolved: a }) => {
        const key = `${d.itemId}:${flag.kind}`;
        return <FlagControl key={flag.kind} a={a} className={actionClass(a)} busy={ctx.busy === key} onRun={() => ctx.act(d.itemId, flag)}>{ctx.busy === key ? "Working…" : <>{a.label}<span className="chg-act-arrow" aria-hidden="true">→</span></>}</FlagControl>;
      })}
    </span>
  );
};

/** Every column of the change log, in the default order. "Source" (Product Velocity, Jira or GitHub) sits in front of "Source type" (UI, API, Claude MCP, GitHub webhook, import, system). */
const COLUMNS: (ChangeColumn & { def: ColDef<ChangeRowData> })[] = [
  { id: "at", name: "Registered", def: { headerName: "Registered", width: 160, valueGetter: (p) => p.data?.at, valueFormatter: (p) => (p.value ? when(String(p.value)) : ""), cellClass: "chg-time" } },
  { id: "initiative", name: "Initiative", def: { headerName: "Initiative", flex: 2, minWidth: 220, cellRenderer: InitiativeCell } },
  { id: "type", name: "Change type", def: { headerName: "Change type", width: 170, cellRenderer: TypeCell } },
  { id: "change", name: "Change", def: { headerName: "Change", flex: 2, minWidth: 240, cellRenderer: ChangeCell } },
  { id: "flags", name: "Flags", def: { headerName: "Flags", flex: 2, minWidth: 260, cellRenderer: FlagsCell, cellClass: "chg-flags", suppressNavigable: true } },
  { id: "actions", name: "Actions", def: { headerName: "Actions", flex: 2, minWidth: 220, cellRenderer: ActionsCell, cellClass: "chg-flags", suppressNavigable: true } },
  { id: "issue", name: "Tracker issue", def: { headerName: "Tracker issue", flex: 2, minWidth: 220, cellRenderer: IssueCell } },
  { id: "jiraUser", name: "Jira user", def: { headerName: "Jira user", width: 180, valueGetter: (p) => p.data?.jiraUser ?? "", tooltipValueGetter: (p) => (p.data?.jiraUser ? `${p.data.jiraUser} moved the Jira issue to this status (from Jira's own history)` : "") } },
  { id: "source", name: "Source", def: { headerName: "Source", width: 150, valueGetter: (p) => p.data?.source } },
  { id: "sourceType", name: "Source type", def: { headerName: "Source type", width: 140, valueGetter: (p) => p.data?.sourceType } },
  { id: "by", name: "By", def: { headerName: "By", width: 230, valueGetter: (p) => p.data?.by, tooltipValueGetter: (p) => p.data?.by } },
];
const ALL_COLUMNS = COLUMNS.map(({ id, name }) => ({ id, name }));
const DEFAULT_COLUMNS = COLUMNS.map((c) => c.id);

const isFullWidthRow = (p: { rowNode: { data?: unknown } }) => isChangeHeader(p.rowNode.data);
const getRowId = (p: { data: ChangeGridRow }) => p.data.id;
/** Two lines for a move with its Build Status; every other row is one line, like the main grid. */
const getRowHeight = (p: { data?: ChangeGridRow }) => {
  const d = p.data;
  return d && !isChangeHeader(d) && d.alsoBuild ? 58 : undefined;
};
const getRowClass = (p: { data?: ChangeGridRow }) => (p.data && !isChangeHeader(p.data) ? `chg-row chg-row-${p.data.type}` : undefined);

type Saved = { columns: string[]; by: ChangeGroupBy | null; then: ChangeGroupBy | null };
const STORE = "pv.changes.view.v4"; // v4: Follow up became two columns, Flags and Actions (as in the main grid); a list saved under v3 would not know the new column
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
export function ChangesReport({ env, load, loadIssues, loadJiraUsers, gates, me = null, onOpen }: { env: ReportEnv; load?: (from: Date, to: Date) => Promise<FeedRow[]>; loadIssues?: (itemIds: string[]) => Promise<Map<string, TrackerRef>>; /** The Jira users who moved the issues to a status, from Jira's own history. */ loadJiraUsers?: (issueKeys: string[], from: Date, to: Date) => Promise<JiraStatusRecord[]>; /** Decision gates: Move to Test and Request gate on a flag. Without it the report has no action buttons. */ gates?: GateSource; /** The signed-in person (left out of the people a gate request can ask). */ me?: string | null; onOpen: (id: string) => void }) {
  const { rows, lookups, controller } = env;
  const [period, setPeriod] = useState<ChangePeriod>("today");
  const [filters, setFilters] = useState<ChangeFilters>(NO_CHANGE_FILTERS);
  const [saved, setSaved] = useState<Saved>(readSaved); // the component mounts only in the browser, after the roadmap has loaded
  const change = (s: Partial<Saved>) => setSaved((cur) => { const n = { ...cur, ...s }; writeSaved(n); return n; });
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [loaded, setLoaded] = useState<{ period: ChangePeriod; reload: number; rows: FeedRow[]; at: Date } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    if (!load) return;
    const { from, to } = changePeriod(period, new Date());
    load(from, to).then((r) => { if (live) { setLoaded({ period, reload, rows: r, at: new Date() }); setFailed(null); } }, (e: unknown) => { if (live) setFailed(e instanceof Error ? e.message : "Could not read the changes."); });
    return () => { live = false; };
  }, [load, period, reload]);

  const feed = loaded && loaded.period === period ? loaded.rows : null; // null only while another period is loading; a refresh keeps showing what is there until the new read arrives
  const refreshing = loaded !== null && loaded.period === period && loaded.reload !== reload && failed === null;
  const items = useMemo(() => new Map<string, ItemInfo>(rows.map((r) => [r.id, { code: String(r.item_code ?? ""), name: String(r.initiative_name ?? ""), rank: r.stack_rank }])), [rows]);
  /** The flags to follow up: the Needs attention reasons that can be worked out from the grid's rows, and the two this report adds for initiatives with no phase. */
  /** The 30, 60 and 90 day outcome reviews, for the flag that asks for them; without them (no gate source, or a failed read) the report shows no such flag. */
  const [outcomeReviews, setOutcomeReviews] = useState<readonly OutcomeReview[] | undefined>(undefined);
  const loadOutcomeReviews = useCallback(() => { if (gates) gates.loadOutcomeReviews().then(setOutcomeReviews, () => setOutcomeReviews(undefined)); }, [gates]);
  useEffect(() => { loadOutcomeReviews(); }, [loadOutcomeReviews, reload]);
  const flags = useMemo(() => changeFlags(rows, controller.todayDate(), outcomeReviews ? { outcomeReviews } : {}), [rows, controller, outcomeReviews]);
  const changedIds = useMemo(() => [...new Set((feed ?? []).map((r) => r.item_id).filter((id) => items.has(id)))].sort().join(","), [feed, items]);
  /** The tracker issue of each initiative that changed. A failure leaves the column empty; it is not worth stopping the report. */
  const [issues, setIssues] = useState<ReadonlyMap<string, TrackerRef>>(new Map());
  useEffect(() => {
    let live = true;
    if (!loadIssues || changedIds === "") return;
    loadIssues(changedIds.split(",")).then((m) => { if (live) setIssues(m); }, () => { if (live) setIssues(new Map()); });
    return () => { live = false; };
  }, [loadIssues, changedIds, reload]);
  /** The Jira user behind each Jira move: a name on a row, read once per list of Jira issues and period. A failure leaves the column empty. */
  const [jiraUsers, setJiraUsers] = useState<readonly JiraStatusRecord[]>([]);
  const jiraKeys = useMemo(() => [...new Set([...issues.values()].filter((i) => i.tracker === "Jira").map((i) => i.key))].sort().join(","), [issues]);
  useEffect(() => {
    let live = true;
    if (!loadJiraUsers || jiraKeys === "") return;
    const { from, to } = changePeriod(period, new Date());
    loadJiraUsers(jiraKeys.split(","), from, to).then((r) => { if (live) setJiraUsers(r); }, () => { if (live) setJiraUsers([]); });
    return () => { live = false; };
  }, [loadJiraUsers, jiraKeys, period, reload]);
  const who = useCallback((id: string | null) => (id ? lookups.members.find((m) => m.user_id === id)?.email ?? "someone" : "the system"), [lookups.members]);

  /** What Jira says now: each status of a linked issue with its category (the mapping behind Build Status), which colours that status wherever it appears. */
  const jiraCategories = useMemo(() => new Map(Object.values(lookups.jira?.links ?? {}).filter((l) => l.status && l.category).map((l) => [l.status as string, l.category as JiraCategory])), [lookups.jira]);
  const allRows = useMemo(() => buildChangeRows(feed ?? [], items, { flags, issues, nameOf: who, jiraUsers, jiraCategories }), [feed, items, flags, issues, who, jiraUsers, jiraCategories]);
  const filtered = useMemo(() => filterChangeRows(allRows, filters), [allRows, filters]);
  const fill = useFillHeight(true); // the grid fills the page below it, like every grid
  const gridRows = useMemo(() => groupChangeRows(filtered, saved.by, saved.then, collapsed), [filtered, saved.by, saved.then, collapsed]);
  const initiatives = useMemo(() => new Set(filtered.map((r) => r.itemId)), [filtered]);
  const flagged = useMemo(() => [...initiatives].filter((id) => (flags.get(id) ?? []).length > 0).length, [initiatives, flags]);

  const toggle = useCallback((key: string) => setCollapsed((s) => { const n = new Set(s); if (!n.delete(key)) n.add(key); return n; }), []);
  /** The keys of every group row when nothing is folded (both levels): what "Collapse all" folds. */
  const groupKeys = useMemo(() => groupChangeRows(filtered, saved.by, saved.then, new Set()).filter(isChangeHeader).map((h) => h.key), [filtered, saved.by, saved.then]);

  // ---- doing something about a flag, and reading everything again
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [gateFor, setGateFor] = useState<{ id: string; gate: GateId } | null>(null);
  const primary = useMemo(() => primaryRowIds(filtered), [filtered]);
  const refresh = useCallback(() => { setReload((n) => n + 1); void controller.refreshFromServer(); }, [controller]);
  const act = useCallback(async (itemId: string, flag: ChangeFlag) => {
    if (!gates || !flag.action) return;
    const a = resolveFlagAction(flag.action, controller.row(itemId)?.initiative_phase, openGateOf(controller.row(itemId)));
    if (a.kind === "requested" || a.kind === "decisions") return;
    if (a.kind === "open") { onOpen(itemId); return; }
    const code = items.get(itemId)?.code ?? "The initiative";
    setMessage(null);
    if (a.kind === "gate") { setGateFor({ id: itemId, gate: a.gate }); return; }
    setBusy(`${itemId}:${flag.kind}`);
    if (a.kind === "outcome-request") {
      const q = await gates.requestOutcomeReview(itemId, a.days);
      setBusy(null);
      setMessage(q.ok ? { ok: true, text: `${a.days} day metrics requested for ${code}. The Product Manager has been notified.` } : { ok: false, text: `${code}: ${q.error}` });
      loadOutcomeReviews();
      return;
    }
    const r = await gates.move(itemId, a.to);
    setBusy(null);
    if (r.ok) { setMessage({ ok: true, text: `${code} moved to ${a.to}.` }); refresh(); } else setMessage({ ok: false, text: `${code} was not moved: ${r.error}` });
  }, [gates, controller, items, refresh, onOpen, loadOutcomeReviews]);
  const context = useMemo<Ctx>(() => ({ toggleGroup: toggle, open: onOpen, primary, canAct: !!gates && controller.canEdit, busy, act: (id, f) => { void act(id, f); }, phaseOf: (id) => controller.row(id)?.initiative_phase, openGateOf: (id) => openGateOf(controller.row(id)) }), [toggle, onOpen, primary, gates, controller, busy, act]);
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
        groupKeys={groupKeys} collapsed={collapsed} onCollapse={setCollapsed}
        onRefresh={refresh} refreshing={refreshing} updatedAt={loaded?.at ?? null}
      />
      <ChangeFilterChips filters={filters} rows={allRows} onChange={setFilters} />

      {message && <p role={message.ok ? "status" : "alert"} className={message.ok ? "notice" : "error"}>{message.text}</p>}
      {!load ? <p role="status" className="muted">The changes are not available here.</p>
        : feed === null ? <p role="status" className="muted">Loading the changes…</p>
        : gridRows.length === 0 ? <p className="rp-empty" role="status">{allRows.length > 0 ? "No change matches the filters or the search" : "No changes in this period for the current filters"}</p>
        : (
          <>
            <p className="muted" role="status">{plural(initiatives.size, "initiative", "initiatives")} changed{flagged > 0 ? `, ${flagged.toLocaleString("en-GB")} to follow up` : ""}{feed.length >= 5000 ? " (showing the latest 5,000 changes)" : ""}.</p>
            <div ref={fill.wrapRef} className="grid-wrap chg-grid" style={fill.height ? { height: fill.height } : undefined} data-testid="changes-grid">
              <AgGridReact<ChangeGridRow>
                theme={GRID_THEME} rowData={gridRows} columnDefs={columnDefs} getRowId={getRowId} context={context} onColumnMoved={onColumnMoved}
                isFullWidthRow={isFullWidthRow} fullWidthCellRenderer={GroupRowRenderer as never} getRowClass={getRowClass} getRowHeight={getRowHeight}
                defaultColDef={{ ...DEFAULT_COL_DEF, suppressHeaderMenuButton: true }} tooltipShowDelay={500} suppressColumnVirtualisation
              />
            </div>
            <p ref={fill.footRef as React.RefObject<HTMLParagraphElement>} className="grid-foot">{shownCount.toLocaleString("en-GB")}{shownCount === allRows.length ? "" : ` of ${allRows.length.toLocaleString("en-GB")}`} changes · {saved.by || saved.then ? "Grouped, newest first inside each group" : "Not grouped, newest first"} · The time is when Product Velocity registered the change</p>
          </>
        )}
      {gateFor && gates && controller.row(gateFor.id) && (
        <RequestGateDialog source={gates} me={me} items={[controller.row(gateFor.id) as never]} initialGate={gateFor.gate} onClose={() => setGateFor(null)}
          onDone={() => { setGateFor(null); setMessage({ ok: true, text: `Gate ${gateFor.gate} requested for ${items.get(gateFor.id)?.code ?? "the initiative"}. It is on the Decisions page.` }); refresh(); }} />
      )}
    </section>
  );
}
