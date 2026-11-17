"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import type { ColDef } from "ag-grid-community";
import {
  ATTENTION_KINDS, CHANGE_GROUP_BYS, CHANGE_PERIODS, CHANGE_TYPES, attentionList, changeCounts, changeGridRows, changePeriod, changeReport, changeTypeLabel, isChangeHeader,
  type ChangeFlag, type ChangeGridRow, type ChangeGroupBy, type ChangePeriod, type ChangeRowData, type ChangeType, type FeedRow, type ItemInfo,
} from "@pv/domain";
import { DEFAULT_COL_DEF, GRID_THEME, GroupRowRenderer } from "../portfolio/grid-kit";
import type { ReportEnv } from "./report-env";

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
type Ctx = { toggleGroup: (key: string) => void; open: (itemId: string) => void; who: (id: string | null) => string };

const FlagPills = ({ flags }: { flags: readonly ChangeFlag[] }) => (
  <>{flags.map((f) => <span key={f.kind} className="pill tone-risk chg-flag" title={f.text}>⚑ {f.label}</span>)}</>
);

const TypeCell = (p: CustomCellRendererProps<ChangeRowData>) => <span className={`pill chg-type chg-type-${p.data!.type}`}>{changeTypeLabel(p.data!.type)}{p.data!.tracker ? ` (${p.data!.tracker})` : ""}</span>;
const ChangeCell = (p: CustomCellRendererProps<ChangeRowData>) => {
  const d = p.data!;
  return <span>{d.from ?? "empty"} <span aria-label="to">→</span> <span className={`pill tone-${d.tone}`}>{d.to ?? "empty"}</span></span>;
};
const InitiativeCell = (p: CustomCellRendererProps<ChangeRowData>) => {
  const d = p.data!;
  return <button type="button" className="link-button" title={d.name} onClick={() => (p.context as Ctx).open(d.itemId)}><strong>{d.code}</strong> {d.name}</button>;
};
/** In a row: the first flag and how many more; all of them are in the tooltip and on the initiative's group header. */
const FlagCell = (p: CustomCellRendererProps<ChangeRowData>) => {
  const f = p.data!.flags;
  if (f.length === 0) return null;
  return <><FlagPills flags={f.slice(0, 1)} />{f.length > 1 && <span className="pill tone-neutral" title={f.map((x) => `${x.label}: ${x.text}`).join("\n")}>+{f.length - 1} more</span>}</>;
};

const isFullWidthRow = (p: { rowNode: { data?: unknown } }) => isChangeHeader(p.rowNode.data);
const getRowId = (p: { data: ChangeGridRow }) => p.data.id;
const getRowClass = (p: { data?: ChangeGridRow }) => (p.data && !isChangeHeader(p.data) ? `chg-row chg-row-${p.data.type}` : undefined);

/**
 * Changes: which initiatives changed in a period and what changed (issue #472), on an AG Grid with grouping (our own header rows), colour by change type
 * and by the value a change ended on, and the flags from Needs attention to follow up. Follows the Reports filters. The time is when Product Velocity
 * registered the change. Actors are named on a row; nothing is counted per person (rule 8). Every colour comes with a word.
 */
export function ChangesReport({ env, load, onOpen }: { env: ReportEnv; load?: (from: Date, to: Date) => Promise<FeedRow[]>; onOpen: (id: string) => void }) {
  const { rows, lookups, controller } = env;
  const [period, setPeriod] = useState<ChangePeriod>("today");
  const [types, setTypes] = useState<ChangeType[]>([]);
  const [by, setBy] = useState<ChangeGroupBy>("initiative");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
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
  const counts = useMemo(() => changeCounts(feed ?? [], items), [feed, items]);
  const groups = useMemo(() => changeReport(feed ?? [], items, types), [feed, items, types]);
  /** The flags of Needs attention that can be worked out from the grid's own rows (the gate waits and open conditions are on the Needs attention page). */
  const flags = useMemo(() => {
    const m = new Map<string, ChangeFlag[]>();
    for (const e of attentionList(rows as never, controller.todayDate())) m.set(e.id, e.reasons.map((r) => ({ kind: r.kind, label: ATTENTION_LABEL[r.kind] ?? r.kind, text: r.text })));
    return m;
  }, [rows, controller]);
  const flaggedGroups = useMemo(() => groups.filter((g) => (flags.get(g.itemId) ?? []).length > 0).length, [groups, flags]);
  const gridRows = useMemo(() => changeGridRows(groups, by, collapsed, flags, flaggedOnly), [groups, by, collapsed, flags, flaggedOnly]);

  const toggleType = (t: ChangeType) => setTypes((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));
  const toggle = useCallback((id: string) => setCollapsed((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; }), []);
  const who = useCallback((id: string | null) => (id ? lookups.members.find((m) => m.user_id === id)?.email ?? "someone" : "the system"), [lookups.members]);
  const context = useMemo<Ctx>(() => ({ toggleGroup: toggle, open: onOpen, who }), [toggle, onOpen, who]);

  const columnDefs = useMemo<ColDef<ChangeRowData>[]>(() => [
    { colId: "at", headerName: "Registered", width: 160, valueGetter: (p) => p.data?.at, valueFormatter: (p) => (p.value ? when(String(p.value)) : ""), cellClass: "chg-time" },
    { colId: "initiative", headerName: "Initiative", flex: 2, minWidth: 220, cellRenderer: InitiativeCell },
    { colId: "type", headerName: "Change type", width: 170, cellRenderer: TypeCell },
    { colId: "change", headerName: "Change", flex: 2, minWidth: 240, cellRenderer: ChangeCell },
    { colId: "source", headerName: "Source", width: 140, valueGetter: (p) => p.data?.via },
    { colId: "by", headerName: "By", width: 190, valueGetter: (p) => (p.data ? who(p.data.actorId) : ""), tooltipValueGetter: (p) => (p.data ? who(p.data.actorId) : "") },
    { colId: "flags", headerName: "Follow up", flex: 2, minWidth: 260, cellRenderer: FlagCell, cellClass: "chg-flags", hide: by === "initiative" }, // the group header of an initiative already shows its flags
  ], [who, by]);

  const { from, to } = changePeriod(period, new Date());
  const range = `${from.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} to ${new Date(to.getTime() - 1).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  if (failed) return <div role="alert" className="error">Could not load the changes: {failed} <button type="button" className="link-button" onClick={() => setReload((n) => n + 1)}>Try again</button></div>;

  return (
    <section className="rp-card rp-wide" aria-label="Changes">
      <h2 className="rp-title">Changes</h2>
      <p className="rp-note">What changed on the initiatives that match the filters above, {range}. Times are when Product Velocity registered the change, in your time zone. Colour shows the type of change (left edge and label) and the value it ended on (green good, amber at risk, red bad, blue active, grey neutral); the words always say the same. A flag ⚑ is a reason from Needs attention to follow up; it is a suggestion, nothing changes by itself. A closed linked issue sets Build Status, never the initiative&apos;s own status. Jira statuses are shown in grey because Jira teams name them freely.</p>
      <div className="view-chips" role="group" aria-label="Period">
        {CHANGE_PERIODS.map((p) => <button key={p.id} type="button" className={period === p.id ? "view-chip view-chip-on" : "view-chip"} aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}>{p.label}</button>)}
      </div>
      <div className="view-chips" role="group" aria-label="Change type">
        {CHANGE_TYPES.map((t) => <button key={t.id} type="button" title={t.hint} className={`view-chip chg-chip chg-chip-${t.id}${types.includes(t.id) ? " view-chip-on" : ""}`} aria-pressed={types.includes(t.id)} onClick={() => toggleType(t.id)}>{t.label} ({counts[t.id]})</button>)}
        {types.length > 0 && <button type="button" className="link-button" onClick={() => setTypes([])}>Clear</button>}
        <button type="button" className={flaggedOnly ? "view-chip view-chip-on" : "view-chip"} aria-pressed={flaggedOnly} title="Only initiatives with a reason to follow up" onClick={() => setFlaggedOnly((v) => !v)}>⚑ To follow up ({flaggedGroups})</button>
      </div>
      <div className="chg-bar">
        <label>Group by{" "}
          <select value={by} onChange={(e) => { setBy(e.target.value as ChangeGroupBy); setCollapsed(new Set()); }}>
            {CHANGE_GROUP_BYS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </label>
        {by !== "none" && gridRows.some(isChangeHeader) && (
          <>
            <button type="button" className="link-button" onClick={() => setCollapsed(new Set(gridRows.filter(isChangeHeader).map((h) => h.id)))}>Collapse all</button>
            <button type="button" className="link-button" onClick={() => setCollapsed(new Set())}>Expand all</button>
          </>
        )}
      </div>

      {!load ? <p role="status" className="muted">The changes are not available here.</p>
        : feed === null ? <p role="status" className="muted">Loading the changes…</p>
        : gridRows.length === 0 ? <p className="rp-empty" role="status">{flaggedOnly ? "No changed initiative has a flag to follow up" : "No changes in this period for the current filters"}</p>
        : (
          <>
            <p className="muted" role="status">{plural(groups.length, "initiative", "initiatives")} changed{flaggedGroups > 0 ? `, ${flaggedGroups.toLocaleString("en-GB")} to follow up` : ""}{feed.length >= 5000 ? " (showing the latest 5,000 changes)" : ""}.</p>
            <div className="grid-wrap chg-grid" data-testid="changes-grid">
              <AgGridReact<ChangeGridRow>
                theme={GRID_THEME} rowData={gridRows} columnDefs={columnDefs as ColDef<ChangeGridRow>[]} getRowId={getRowId} context={context}
                isFullWidthRow={isFullWidthRow} fullWidthCellRenderer={GroupRowRenderer as never} getRowClass={getRowClass}
                defaultColDef={{ ...DEFAULT_COL_DEF, suppressHeaderMenuButton: true }} tooltipShowDelay={500}
              />
            </div>
            <p className="grid-foot">{gridRows.filter((r) => !isChangeHeader(r)).length.toLocaleString("en-GB")} changes · {by === "none" ? "Not grouped, newest first" : `Grouped by ${CHANGE_GROUP_BYS.find((g) => g.id === by)!.label.toLowerCase()}, newest first inside each group`} · The time is when Product Velocity registered the change</p>
          </>
        )}
    </section>
  );
}

/** Labels of the Needs attention kinds. */
const ATTENTION_LABEL: Record<string, string> = Object.fromEntries(ATTENTION_KINDS.map((k) => [k.id, k.label]));
