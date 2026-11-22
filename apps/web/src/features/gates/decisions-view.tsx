"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import type { ColDef, GridApi, GridReadyEvent, SelectionChangedEvent } from "ag-grid-community";
import {
  GATES, QUEUE_FILTERS, bulkDecisionSummary, decidableCount, decisionGridRows, decisionsCsv, filterDecisionRows, filterQueue, gateChecklist, gateTitle, isOpen, outcomeLabel,
  type DecisionFilters, type DecisionGridRow, type GateId, type GateOutcome, type GateRequest, type QueueFilter,
} from "@pv/domain";
import { DEFAULT_COL_DEF, GRID_THEME } from "../portfolio/grid-kit";
import { ColumnPicker, ListSearch, MultiFilter, SavedViews, downloadText, usePersisted, type SavedView } from "../lists/list-kit";
import { DecideDialog, type DecideRow, type DialogItem } from "./gate-dialogs";
import type { Approvers, Condition, Decider, GateItem, GateSource } from "./gate-source";

type Props = {
  source: GateSource;
  /** The signed-in person; null when staff look in. */
  me: string | null;
  /** False when staff are looking in: the screen shows everything and offers no decision (rule 10). */
  mayDecide?: boolean;
  initialFilter?: QueueFilter;
  /** Where an initiative opens (its page). */
  pageHref?: (code: string) => string;
  /** Today, for how long a request has waited (tests pass a fixed day). */
  today?: Date;
};

const dateText = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
const short = (email: string) => email.split("@")[0]!;

type Choice = { gates: GateId[]; outcomes: GateOutcome[]; overdue: boolean; incomplete: boolean; search: string };
const NO_CHOICE: Choice = { gates: [], outcomes: [], overdue: false, incomplete: false, search: "" };
const isChoice = (v: unknown): v is Choice => !!v && typeof v === "object" && Array.isArray((v as Choice).gates) && Array.isArray((v as Choice).outcomes);
const BUILT_IN_VIEWS: readonly SavedView<Choice>[] = [
  { name: "Waiting more than a week", state: { ...NO_CHOICE, overdue: true } },
  { name: "Incomplete checklist", state: { ...NO_CHOICE, incomplete: true } },
  { name: "Gate B only", state: { ...NO_CHOICE, gates: ["B"] } },
];
type ColId = "gate" | "when" | "by" | "waiting" | "checklist" | "outcome" | "decidedBy" | "phase" | "health" | "hypothesis" | "rationale" | "can";
const COLUMN_NAMES: readonly { id: ColId; name: string }[] = [
  { id: "gate", name: "Gate" }, { id: "when", name: "Requested or decided" }, { id: "by", name: "Requested by" }, { id: "waiting", name: "Days waiting" }, { id: "checklist", name: "Checklist" },
  { id: "outcome", name: "Outcome" }, { id: "decidedBy", name: "Decided by" }, { id: "phase", name: "Phase" }, { id: "health", name: "Health" }, { id: "hypothesis", name: "Hypothesis" },
  { id: "rationale", name: "Rationale" }, { id: "can", name: "You can decide" },
];
/** Which columns each tab starts without: the open ones do not need the outcome, the decided ones do not need the wait. */
const DEFAULT_HIDDEN: Record<QueueFilter, string[]> = {
  waiting: ["outcome", "decidedBy", "rationale", "phase", "health", "hypothesis"], decided: ["waiting", "checklist", "can", "phase", "health", "hypothesis", "by"],
  mine: ["decidedBy", "rationale", "phase", "health", "hypothesis", "can"], "can-decide": ["outcome", "decidedBy", "rationale", "phase", "health", "hypothesis", "can"],
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const OUTCOME_OPTIONS: { value: GateOutcome; label: string }[] = [{ value: "go", label: "Go" }, { value: "go_with_conditions", label: "Go with conditions" }, { value: "hold", label: "Hold" }, { value: "stop", label: "Stop" }];

type Ctx = { open: (row: DecisionGridRow) => void; decide: (row: DecisionGridRow, outcome?: GateOutcome) => void; mayDecide: boolean };
const NameCell = (p: CustomCellRendererProps<DecisionGridRow>) => {
  const d = p.data!, ctx = p.context as Ctx;
  return <a className="lst-name" href={`#${d.code}`} title={`${d.code} ${d.name}`} onClick={(e) => { e.preventDefault(); ctx.open(d); }}><span className="mono">{d.code}</span> <strong>{d.name}</strong></a>;
};
const ChecklistCell = (p: CustomCellRendererProps<DecisionGridRow>) => {
  const d = p.data!;
  if (d.checklistTotal === 0) return <span className="muted">Not available</span>;
  return (
    <span className="lst-pills" title={d.checklist.map((c) => `${c.ok ? "✓" : "✗"} ${c.label}`).join("\n") + (d.checklistRecorded ? "" : "\n(worked out now; none was recorded with the request)")}>
      <span className={`pill ${d.checklistComplete ? "tone-good" : "tone-risk"}`}>{d.checklistDone} of {d.checklistTotal} · {d.checklistComplete ? "complete" : "incomplete"}</span>
    </span>
  );
};
const WaitCell = (p: CustomCellRendererProps<DecisionGridRow>) => {
  const d = p.data!;
  if (d.daysWaiting === null) return null;
  return <span className={d.overdue ? "pill tone-risk" : ""} title={d.overdue ? "Waiting longer than a week" : undefined}>{d.daysWaiting} {d.daysWaiting === 1 ? "day" : "days"}{d.overdue ? " · long" : ""}</span>;
};
const ActionCell = (p: CustomCellRendererProps<DecisionGridRow>) => {
  const d = p.data!, ctx = p.context as Ctx;
  if (d.state === "Withdrawn") return <span className="muted">Withdrawn</span>;
  if (d.state === "Decided") return <span className="muted">{d.outcomeLabel}{d.fastLane ? " · fast lane" : ""}</span>;
  if (!ctx.mayDecide || !d.canDecide) return <span className="muted">{ctx.mayDecide ? "Not yours to decide" : "Read only"}</span>;
  return (
    <span className="lst-act">
      <button type="button" className="btn lst-small lst-go" onClick={() => ctx.decide(d, "go")}>Go</button>
      <button type="button" className="btn lst-small" onClick={() => ctx.decide(d, "hold")}>Hold</button>
      <button type="button" className="btn lst-small" onClick={() => ctx.decide(d)}>Decide…</button>
    </span>
  );
};

/**
 * The Decisions screen (issue #323, docs/28-DECISION-GATES.md section 6), as a list on the shared grid (Ashu, 2026-11-22): every gate request of the workspace, about
 * the gates, not about one person. Anyone with approval rights for a gate can decide it; the first decision wins. Search, filter, sort, choose columns, select several
 * and decide them together. Open a row to read the gate pack; J and K move, G, C, H, S decide.
 */
export function DecisionsView({ source, me, mayDecide = true, initialFilter = "waiting", pageHref = (c) => `/portfolio/${encodeURIComponent(c)}`, today: todayProp }: Props) {
  const [requests, setRequests] = useState<GateRequest[] | null>(null);
  const [items, setItems] = useState<Map<string, GateItem>>(new Map());
  const [can, setCan] = useState<GateId[]>([]);
  const [deciders, setDeciders] = useState<Decider[]>([]);
  const [approvers, setApprovers] = useState<Approvers>({ A: [], B: [], C: [] });
  const [allDocs, setAllDocs] = useState<Record<string, { kind: string; status: string }[]>>({});
  const [docs, setDocs] = useState<Record<string, { kind: string; status: string }[]>>({});
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [filter, setFilter] = useState<QueueFilter>(initialFilter);
  const [choice, setChoice] = usePersisted<Choice>("pv.decisions.choice.v1", NO_CHOICE, isChoice);
  const [hiddenByTab, setHiddenByTab] = usePersisted<Partial<Record<QueueFilter, string[]>>>("pv.decisions.hidden.v1", {}, (v): v is Partial<Record<QueueFilter, string[]>> => !!v && typeof v === "object");
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ rows: DecideRow[]; outcome?: GateOutcome } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const api = useRef<GridApi<DecisionGridRow> | null>(null);

  const [reload, setReload] = useState(0);
  const load = useCallback(() => setReload((n) => n + 1), []);
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const reqs = await source.loadRequests();
        const ids = [...new Set(reqs.map((r) => r.item_id))];
        const [its, mine, dec, appr, dd] = await Promise.all([
          source.loadItems(ids), mayDecide ? source.myGates() : Promise.resolve([] as GateId[]),
          source.loadDeciders().catch(() => [] as Decider[]), source.loadApprovers().catch(() => ({ A: [], B: [], C: [] }) as Approvers),
          source.loadDocsFor(ids).catch(() => ({}) as Record<string, { kind: string; status: string }[]>),
        ]);
        if (off) return;
        setRequests(reqs); setItems(new Map(its.map((i) => [i.id, i]))); setCan(mine); setDeciders(dec); setApprovers(appr); setAllDocs(dd); setError(null);
      } catch (e) { if (!off) setError((e as Error).message); }
    })();
    return () => { off = true; };
  }, [source, mayDecide, reload]);

  const email = useCallback((id: string | null) => (id ? deciders.find((d) => d.user_id === id)?.email ?? "Someone who left" : "Not recorded"), [deciders]);
  const today = useMemo(() => todayProp ?? new Date(), [todayProp]);
  const everyRow = useMemo(() => decisionGridRows(requests ?? [], {
    today, me, can, item: (id) => items.get(id) as unknown as Record<string, unknown> | undefined, docs: (id) => allDocs[id] ?? [], email,
  }), [requests, today, me, can, items, allDocs, email]);
  const byId = useMemo(() => new Map(everyRow.map((r) => [r.id, r])), [everyRow]);
  const tabRows = useMemo(() => filterQueue(requests ?? [], filter, me, can).map((q) => byId.get(q.id)!).filter(Boolean), [requests, filter, me, can, byId]);
  const filters: DecisionFilters = useMemo(() => ({ gates: choice.gates, outcomes: choice.outcomes, overdue: choice.overdue, incomplete: choice.incomplete, search: choice.search }), [choice]);
  const rows = useMemo(() => filterDecisionRows(tabRows, filters), [tabRows, filters]);
  const open = requests ? decidableCount(requests, can) : 0;
  const waitingCount = requests ? requests.filter(isOpen).length : 0;
  const current = rows.find((r) => r.id === active) ?? null;
  const currentReq = current ? requests?.find((r) => r.id === current.id) ?? null : null;
  const itemOf = (r: { item_id: string }) => items.get(r.item_id);
  const hidden = hiddenByTab[filter] ?? DEFAULT_HIDDEN[filter];
  const touched = choice.gates.length > 0 || choice.outcomes.length > 0 || choice.overdue || choice.incomplete || choice.search !== "";
  const set = (patch: Partial<Choice>) => { setChoice((c) => ({ ...c, ...patch })); setPicked([]); };

  // the active row's documents and conditions (the gate pack)
  useEffect(() => {
    if (!currentReq) return;
    let off = false;
    void source.loadDocs(currentReq.item_id).then((d) => { if (!off) setDocs((s) => ({ ...s, [currentReq.item_id]: d })); }, () => undefined);
    void source.loadConditions(currentReq.item_id).then((c) => { if (!off) setConditions(c); }, () => undefined);
    return () => { off = true; };
  }, [currentReq, source]);

  const whoCanDecide = (gate: GateId) => {
    const names = deciders.filter((d) => !d.is_service_account && (d.role === "admin" || d.is_approver || approvers[gate].includes(d.user_id))).map((d) => short(d.email));
    return names.length === 0 ? "Admins" : names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
  };

  const decideRows = useCallback((reqs: DecisionGridRow[], outcome?: GateOutcome) => {
    const ok = reqs.filter((r) => r.canDecide);
    if (ok.length === 0) { setError(mayDecide ? "You do not have approval rights for the selected requests." : "Looking in as staff: decisions are not available."); return; }
    setError(null); setMessage(null);
    setDialog({ rows: ok.map((r) => ({ request: requests!.find((q) => q.id === r.id)!, item: items.get(r.itemId) as unknown as DialogItem | undefined })), ...(outcome ? { outcome } : {}) });
  }, [mayDecide, requests, items]);

  // keys work wherever the focus is on this screen (like the item page), except inside a field or a dialog
  const show = (id: string | null) => {
    setActive(id);
    const node = id ? api.current?.getRowNode(id) : null;
    if (node?.rowIndex != null) api.current?.ensureIndexVisible(node.rowIndex);
  };
  // the highlighted row is drawn from `active`, so redraw once the new value is in place
  const activeRef = useRef<string | null>(null);
  useEffect(() => { activeRef.current = active; api.current?.redrawRows(); }, [active]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable=true], [role='dialog'], .lst-panel")) return;
      if (e.metaKey || e.ctrlKey || e.altKey || dialog) return;
      const i = rows.findIndex((r) => r.id === active);
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); show(rows[Math.min(rows.length - 1, i + 1)]?.id ?? null); }
      else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); show(rows[Math.max(0, i - 1)]?.id ?? null); }
      else if (e.key === "Escape") { show(null); }
      else if (e.key === "x" && current && current.canDecide) { e.preventDefault(); const n = api.current?.getRowNode(current.id); n?.setSelected(!n.isSelected()); }
      else if (current && ["g", "c", "h", "s"].includes(e.key)) {
        e.preventDefault();
        decideRows([current], ({ g: "go", c: "go_with_conditions", h: "hold", s: "stop" } as const)[e.key as "g"]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // decideRows and show only read state that is in the list below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, active, current, dialog, can, mayDecide, items]);

  const pickedRows = useMemo(() => rows.filter((r) => picked.includes(r.id)), [rows, picked]);
  const summary = useMemo(() => bulkDecisionSummary(pickedRows), [pickedRows]);

  const ctx = useMemo<Ctx>(() => ({ open: (r) => setActive(r.id), decide: (r, o) => decideRows([r], o), mayDecide }), [decideRows, mayDecide]);
  const cols = useMemo<ColDef<DecisionGridRow>[]>(() => {
    const d = (id: ColId, def: ColDef<DecisionGridRow>): ColDef<DecisionGridRow> => ({ colId: id, sortable: true, ...def });
    return [
      { colId: "initiative", headerName: "Initiative", field: "name", width: 320, cellRenderer: NameCell, sortable: true, pinned: "left", comparator: (_a, _b, x, y) => x.data!.code.localeCompare(y.data!.code, undefined, { numeric: true }) },
      d("gate", { headerName: "Gate", field: "gateLabel", width: 210 }),
      d("when", { headerName: "Requested or decided", width: 170, valueGetter: (p) => (p.data!.decidedAt ?? p.data!.requestedAt), valueFormatter: (p) => dateText(p.value as string), tooltipValueGetter: (p) => (p.data!.decidedAt ? `Decided ${dateText(p.data!.decidedAt)}` : `Requested ${dateText(p.data!.requestedAt)}`) }),
      d("by", { headerName: "Requested by", field: "requestedBy", width: 170, valueFormatter: (p) => (String(p.value).includes("@") ? short(String(p.value)) : String(p.value)) }),
      d("waiting", { headerName: "Days waiting", field: "daysWaiting", width: 140, type: "rightAligned", cellRenderer: WaitCell, comparator: (a, b) => (a ?? -1) - (b ?? -1) }),
      d("checklist", { headerName: "Checklist", field: "checklistDone", width: 210, cellRenderer: ChecklistCell, comparator: (_a, _b, x, y) => x.data!.checklistDone / Math.max(1, x.data!.checklistTotal) - y.data!.checklistDone / Math.max(1, y.data!.checklistTotal) }),
      d("outcome", { headerName: "Outcome", field: "outcomeLabel", width: 170, valueFormatter: (p) => p.value || "Open" }),
      d("decidedBy", { headerName: "Decided by", field: "decidedBy", width: 150, valueFormatter: (p) => (String(p.value).includes("@") ? short(String(p.value)) : String(p.value)) }),
      d("phase", { headerName: "Phase", field: "phase", width: 110 }),
      d("health", { headerName: "Health", field: "health", width: 120, cellRenderer: (q: CustomCellRendererProps<DecisionGridRow>) => (q.value ? <span className={`pill health-${slug(String(q.value))}`}>{String(q.value)}</span> : null) }),
      d("hypothesis", { headerName: "Hypothesis", field: "hypothesis", flex: 1, minWidth: 220, tooltipField: "hypothesis" }),
      d("rationale", { headerName: "Rationale", field: "rationale", flex: 1, minWidth: 220, tooltipField: "rationale" }),
      d("can", { headerName: "You can decide", field: "canDecide", width: 150, valueFormatter: (p) => (p.value ? "Yes" : "No") }),
      { colId: "action", headerName: "Decide", width: 230, cellRenderer: ActionCell, pinned: "right", sortable: false, resizable: false },
    ];
  }, []);
  const hasRows = rows.length > 0;
  useEffect(() => { api.current?.setColumnsVisible(COLUMN_NAMES.map((c) => c.id), true); api.current?.setColumnsVisible(hidden.filter((h) => COLUMN_NAMES.some((c) => c.id === h)), false); }, [hidden, filter, hasRows]);
  const onReady = (e: GridReadyEvent<DecisionGridRow>) => { api.current = e.api; e.api.setColumnsVisible(hidden, false); };
  const onSelection = (e: SelectionChangedEvent<DecisionGridRow>) => setPicked(e.api.getSelectedRows().map((r) => r.id));
  const switchTab = (f: QueueFilter) => { setFilter(f); setPicked([]); setActive(null); };

  return (
    <div className="decisions lst" ref={root}>
      <div className="page-head">
        <h1>Decisions</h1>
        <p className="muted">Every gate request in the workspace. Anyone with approval rights for a gate can decide it; the first decision wins.</p>
      </div>
      <div className="help-tabs" role="tablist" aria-label="Filter requests">
        {QUEUE_FILTERS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={`help-tab${filter === f.id ? " is-active" : ""}`} onClick={() => switchTab(f.id)}>
            {f.label}{f.id === "waiting" && requests ? ` (${waitingCount})` : ""}{f.id === "can-decide" && requests ? ` (${open})` : ""}
          </button>
        ))}
      </div>

      <div className="lst-bar">
        <ListSearch value={choice.search} onChange={(v) => setChoice((c) => ({ ...c, search: v }))} placeholder="Search initiatives, people, hypotheses…  ( / )" label="Search Decisions" />
        <MultiFilter label="Gate" options={(["A", "B", "C"] as GateId[]).map((g) => ({ value: g, label: gateTitle(g), count: tabRows.filter((r) => r.gate === g).length }))} selected={choice.gates} onChange={(v) => set({ gates: v })} />
        {filter === "decided" && <MultiFilter label="Outcome" options={OUTCOME_OPTIONS.map((o) => ({ ...o, count: tabRows.filter((r) => r.outcome === o.value).length }))} selected={choice.outcomes} onChange={(v) => set({ outcomes: v })} />}
        {filter !== "decided" && <label className="lst-check"><input type="checkbox" checked={choice.overdue} onChange={(e) => set({ overdue: e.target.checked })} /> Waiting more than a week ({tabRows.filter((r) => r.overdue).length})</label>}
        {filter !== "decided" && <label className="lst-check"><input type="checkbox" checked={choice.incomplete} onChange={(e) => set({ incomplete: e.target.checked })} /> Incomplete checklist ({tabRows.filter((r) => r.state === "Waiting" && !r.checklistComplete).length})</label>}
        <span className="lst-spacer" />
        <SavedViews storeKey="pv.decisions.views.v1" current={choice} onApply={(c) => { setChoice({ ...NO_CHOICE, ...c }); setPicked([]); }} builtIn={BUILT_IN_VIEWS} />
        <ColumnPicker columns={COLUMN_NAMES} hidden={hidden} onChange={(h) => setHiddenByTab((m) => ({ ...m, [filter]: h }))} onReset={() => setHiddenByTab((m) => ({ ...m, [filter]: DEFAULT_HIDDEN[filter] }))} />
        <button type="button" className="lst-btn" disabled={rows.length === 0} onClick={() => downloadText(`decisions-${new Date().toISOString().slice(0, 10)}.csv`, decisionsCsv(pickedRows.length > 0 ? pickedRows : rows))} title={pickedRows.length > 0 ? "Download the selected rows" : "Download the rows shown"}>Download CSV</button>
        {touched && <button type="button" className="link-button" onClick={() => { setChoice(NO_CHOICE); setPicked([]); }}>Clear filters</button>}
      </div>

      {error && <p role="alert" className="error">{error}</p>}
      {message && <p role="status" className="quick-add-ok">{message}</p>}
      {pickedRows.length > 0 && (
        <div className="bulk-bar" role="region" aria-label="Decide the selected requests">
          <strong className="bulk-count">{pickedRows.length} selected</strong>
          {mayDecide && summary.decidable > 0 && (
            <>
              <button type="button" className="bulk-btn bulk-btn-open" onClick={() => decideRows(pickedRows, "go")}>Go {summary.decidable}…</button>
              <button type="button" className="bulk-btn" onClick={() => decideRows(pickedRows, "go_with_conditions")}>Go with conditions…</button>
              <button type="button" className="bulk-btn" onClick={() => decideRows(pickedRows, "hold")}>Hold…</button>
              <button type="button" className="bulk-btn bulk-btn-danger" onClick={() => decideRows(pickedRows, "stop")}>Stop…</button>
              <button type="button" className="bulk-btn" onClick={() => decideRows(pickedRows)}>Decide {summary.decidable}…</button>
            </>
          )}
          <button type="button" className="bulk-btn" onClick={() => { api.current?.deselectAll(); setPicked([]); }}>Clear selection</button>
          {summary.incomplete > 0 && <span className="lst-warn" role="status">{summary.incomplete} of the selected {summary.incomplete === 1 ? "has" : "have"} an incomplete checklist. The checklist informs; it never blocks a decision. You will give a rationale before anything is saved.</span>}
          {summary.notDecidable > 0 && <span className="muted">{summary.notDecidable} cannot be decided by you and will be left out.</span>}
        </div>
      )}

      {requests === null ? <p role="status">Loading…</p> : rows.length === 0 ? (
        <p className="muted" role="status">{touched ? "Nothing matches the filters." : filter === "waiting" ? "No gate requests are waiting." : filter === "decided" ? "No decisions yet." : filter === "mine" ? "You have not requested a gate." : "Nothing here needs your decision."}</p>
      ) : (
        <div className="lst-body">
          <div className="lst-grid" data-testid="decisions-grid" role="region" aria-label="Gate requests">
            <AgGridReact<DecisionGridRow>
              theme={GRID_THEME} rowData={rows} columnDefs={cols} getRowId={(p) => p.data.id} context={ctx} defaultColDef={{ ...DEFAULT_COL_DEF, suppressHeaderMenuButton: true }}
              selectionColumnDef={{ pinned: "left", width: 44, resizable: false }} rowSelection={{ mode: "multiRow", checkboxes: true, headerCheckbox: true, enableClickSelection: false, isRowSelectable: (n) => Boolean(n.data?.canDecide) }}
              onSelectionChanged={onSelection} onGridReady={onReady} tooltipShowDelay={500} suppressColumnVirtualisation suppressCellFocus rowHeight={42}
              getRowClass={(p) => (p.data && p.data.id === activeRef.current ? "lst-active" : undefined)} onRowClicked={(e) => { if (e.data && !(e.event?.target as HTMLElement | null)?.closest("button, a, input")) setActive(e.data.id); }}
            />
          </div>
          {current && currentReq && (
            <aside className="decisions-pack" aria-label="Gate pack">
              <h2>{itemOf(currentReq) ? `${itemOf(currentReq)!.item_code} ${itemOf(currentReq)!.initiative_name}` : currentReq.item_id}</h2>
              {itemOf(currentReq) && <p><a href={pageHref(itemOf(currentReq)!.item_code)}>Open the initiative</a></p>}
              <p><strong>{gateTitle(currentReq.gate)}</strong><br />{GATES[currentReq.gate].question}</p>
              <p className="muted">Requested by {email(currentReq.requested_by)} on {dateText(currentReq.requested_at)}{current.daysWaiting !== null ? `, waiting ${current.daysWaiting} ${current.daysWaiting === 1 ? "day" : "days"}` : ""}.</p>
              <h3>Checklist</h3>
              <ul className="gate-checklist">
                {(currentReq.criteria.length > 0 ? currentReq.criteria : itemOf(currentReq) ? gateChecklist(currentReq.gate, itemOf(currentReq) as unknown as Record<string, unknown>, docs[currentReq.item_id] ?? []) : []).map((c) => (
                  <li key={c.label}><span aria-hidden="true">{c.ok ? "✓" : "✗"}</span> {c.label} <span className="visually-hidden">{c.ok ? "(done)" : "(missing)"}</span></li>
                ))}
              </ul>
              <h3>Documents</h3>
              <p>{(docs[currentReq.item_id] ?? []).length === 0 ? "None yet." : (docs[currentReq.item_id] ?? []).map((d) => `${d.kind} (${d.status.replace("_", " ")})`).join(", ")}</p>
              {itemOf(currentReq)?.hypothesis && <><h3>Hypothesis</h3><p>{itemOf(currentReq)!.hypothesis}</p></>}
              {currentReq.decided_at ? (
                <>
                  <h3>Decision</h3>
                  <p><strong>{outcomeLabel(currentReq.outcome)}</strong>{currentReq.fast_lane ? " (fast lane)" : ""} by {email(currentReq.decided_by)} on {dateText(currentReq.decided_at)}</p>
                  {currentReq.rationale && <blockquote>{currentReq.rationale}</blockquote>}
                  {currentReq.skipped_phases.length > 0 && <p>Skipped phases: {currentReq.skipped_phases.join(", ")}.</p>}
                  {conditions.filter((c) => c.review_id === currentReq.id).length > 0 && (
                    <ul>{conditions.filter((c) => c.review_id === currentReq.id).map((c) => <li key={c.id}>{c.done_at ? "✓" : "☐"} {c.text}</li>)}</ul>
                  )}
                </>
              ) : currentReq.withdrawn_at ? <p className="muted">This request was withdrawn when the initiative moved.</p> : (
                <div className="decisions-actions">
                  {can.includes(currentReq.gate) ? (
                    <>
                      <button type="button" className="btn btn-confirm" onClick={() => decideRows([current], "go")}>Go <kbd>G</kbd></button>
                      <button type="button" className="btn" onClick={() => decideRows([current], "go_with_conditions")}>Go with conditions <kbd>C</kbd></button>
                      <button type="button" className="btn" onClick={() => decideRows([current], "hold")}>Hold <kbd>H</kbd></button>
                      <button type="button" className="btn btn-danger-quiet" onClick={() => decideRows([current], "stop")}>Stop <kbd>S</kbd></button>
                    </>
                  ) : <p className="muted">{mayDecide ? `You do not have approval rights for gate ${currentReq.gate}. ${whoCanDecide(currentReq.gate)} can decide it.` : "Looking in as staff: decisions are not available."}</p>}
                </div>
              )}
              <p className="muted">Who can decide: {whoCanDecide(currentReq.gate)}.</p>
              <p className="muted">J and K move through the list, X selects, Escape closes this panel.</p>
            </aside>
          )}
        </div>
      )}
      <p className="muted lst-foot">{rows.length} of {tabRows.length} requests shown. Click a header to sort; Download CSV saves what you see. How long a request has waited is about the request, never about a person.</p>
      {dialog && <DecideDialog source={source} rows={dialog.rows} {...(dialog.outcome ? { initialOutcome: dialog.outcome } : {})} onClose={() => { setDialog(null); }} onDone={() => { api.current?.deselectAll(); setPicked([]); setMessage("Decision saved."); load(); }} />}
    </div>
  );
}
