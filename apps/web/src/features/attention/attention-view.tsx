"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import type { ColDef, GridApi, GridReadyEvent, SelectionChangedEvent } from "ag-grid-community";
import {
  ATTENTION_KINDS, SNOOZE_CHOICES, URGENCIES, attentionCounts, attentionCsv, attentionGridRows, attentionLabel, attentionList, bulkMoveSplit, facetCounts, filterAttentionRows, kindCounts, snoozeDate,
  type AttentionAction, type AttentionFilters, type AttentionGridRow, type AttentionKind, type GateId, type GateRequest, type Snooze, type Urgency,
} from "@pv/domain";
import type { PortfolioController } from "../portfolio/controller";
import type { Lookups } from "../portfolio/types";
import { useViewRows } from "../portfolio/use-view-rows";
import { DEFAULT_COL_DEF, GRID_THEME } from "../portfolio/grid-kit";
import { ItemPanel } from "../portfolio/item-panel";
import { useWorkspace } from "../workspace/provider";
import { RequestGateDialog } from "../gates/gate-dialogs";
import type { GateSource } from "../gates/gate-source";
import { ColumnPicker, ListSearch, MultiFilter, SavedViews, downloadText, usePersisted, type SavedView } from "../lists/list-kit";

type Props = { controller: PortfolioController; lookups: Lookups; me: string | null; source: GateSource; pageHref?: (code: string) => string; decisionsHref?: string };

/** What the person has chosen to see: remembered in this browser, and what a saved view holds. */
type Choice = { kinds: AttentionKind[]; urgencies: Urgency[]; phases: string[]; healths: string[]; groups: string[]; search: string; showSnoozed: boolean; actionable: boolean };
const NO_CHOICE: Choice = { kinds: [], urgencies: [], phases: [], healths: [], groups: [], search: "", showSnoozed: false, actionable: false };
const isChoice = (v: unknown): v is Choice => !!v && typeof v === "object" && Array.isArray((v as Choice).kinds) && Array.isArray((v as Choice).urgencies);
const BUILT_IN_VIEWS: readonly SavedView<Choice>[] = [
  { name: "Urgent", state: { ...NO_CHOICE, urgencies: ["Urgent"] } },
  { name: "One click away", state: { ...NO_CHOICE, actionable: true } },
  { name: "Waiting for a decision", state: { ...NO_CHOICE, kinds: ["gate-waiting"] } },
  { name: "Delivery risk", state: { ...NO_CHOICE, kinds: ["delivery-risk"] } },
];

type ColumnId = "urgency" | "reasons" | "why" | "phase" | "health" | "build" | "inPhase" | "waiting" | "group" | "project" | "owner" | "rank";
const COLUMN_NAMES: readonly { id: ColumnId; name: string }[] = [
  { id: "urgency", name: "Urgency" }, { id: "reasons", name: "Reasons" }, { id: "why", name: "What is wrong" }, { id: "phase", name: "Phase" }, { id: "health", name: "Health" },
  { id: "build", name: "Build status" }, { id: "inPhase", name: "Days in phase" }, { id: "waiting", name: "Days waiting for a decision" }, { id: "group", name: "Initiative group" },
  { id: "project", name: "Project" }, { id: "owner", name: "Product manager" }, { id: "rank", name: "Stack rank" },
];
const DEFAULT_HIDDEN: string[] = ["build", "group", "project", "owner", "rank"];

const TONE: Partial<Record<AttentionKind, string>> = { "delivery-risk": "tone-bad", "cancelled-building": "tone-bad", "gate-waiting": "tone-risk", "hold-due": "tone-risk", conditions: "tone-risk", stalled: "tone-risk", "build-done": "tone-good" };
const URGENCY_TONE: Record<Urgency, string> = { Urgent: "tone-bad", Soon: "tone-risk", "Look at it": "tone-neutral" };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

type Ctx = {
  open: (id: string) => void; run: (row: AttentionGridRow, a: AttentionAction) => void; snoozeOne: (row: AttentionGridRow) => void; unsnoozeOne: (row: AttentionGridRow) => void;
  busy: string | null; canEdit: boolean; today: string;
};
const actionTitle = (a: AttentionAction) => a.label;

const NameCell = (p: CustomCellRendererProps<AttentionGridRow>) => {
  const d = p.data!, ctx = p.context as Ctx;
  return <a className="lst-name" href={`#${d.code}`} title={`${d.code} ${d.name}`} onClick={(e) => { e.preventDefault(); ctx.open(d.id); }}><span className="mono">{d.code}</span> <strong>{d.name}</strong></a>;
};
const UrgencyCell = (p: CustomCellRendererProps<AttentionGridRow>) => <span className={`pill ${URGENCY_TONE[p.data!.urgency]}`}>{p.data!.urgency}</span>;
const ReasonsCell = (p: CustomCellRendererProps<AttentionGridRow>) => {
  const d = p.data!;
  const shown = d.kinds.slice(0, 2), more = d.kinds.length - shown.length;
  return (
    <span className="lst-pills" title={d.reasons.concat(d.snoozedReasons).map((r) => `${attentionLabel(r.kind)}: ${r.text}`).join("\n")}>
      {shown.map((k) => <span key={k} className={`pill ${TONE[k] ?? "tone-neutral"}`}>{attentionLabel(k)}</span>)}
      {more > 0 && <span className="pill tone-neutral">+{more}</span>}
    </span>
  );
};
const HealthCell = (p: CustomCellRendererProps<AttentionGridRow>) => (p.value ? <span className={`pill health-${slug(String(p.value))}`}>{String(p.value)}</span> : <span className="muted">Not set</span>);
const ActionCell = (p: CustomCellRendererProps<AttentionGridRow>) => {
  const d = p.data!, ctx = p.context as Ctx;
  const busy = ctx.busy === d.id;
  if (d.snoozed) {
    const z = d.snoozedReasons[0]?.snoozed;
    return <span className="lst-act"><span className="muted">{z?.until ? `Snoozed to ${z.until}` : "Dismissed"}</span> {ctx.canEdit && <button type="button" className="btn lst-small" onClick={() => ctx.unsnoozeOne(d)}>Bring back</button>}</span>;
  }
  const main = d.actions[0];
  return (
    <span className="lst-act">
      {main && <button type="button" className="btn lst-small lst-go" disabled={busy || (!ctx.canEdit && main.action.type !== "decisions")} title={d.actions.length > 1 ? d.actions.map((a) => actionTitle(a.action)).join(" · ") : undefined} onClick={() => ctx.run(d, main.action)}>{busy ? "Working…" : main.action.label}</button>}
      {d.actions.length > 1 && <span className="muted" title={d.actions.slice(1).map((a) => a.action.label).join(", ")}>+{d.actions.length - 1}</span>}
      {ctx.canEdit && <button type="button" className="btn lst-small" aria-label={`Snooze ${d.code}`} title="Snooze or dismiss (Z)" onClick={() => ctx.snoozeOne(d)}>Snooze</button>}
    </span>
  );
};

const byTier = (a: AttentionGridRow, b: AttentionGridRow) => a.tier - b.tier || a.rank - b.rank;
const cmpNum = (a: number | null | undefined, b: number | null | undefined) => (a ?? -1) - (b ?? -1);

/**
 * The Needs attention screen (issue #337, rebuilt as a list on the shared grid, Ashu 2026-11-22): what has to be looked at, why, how long, and the next step in one
 * click. Rules live in `attentionList` (packages/domain/src/attention.ts); this screen filters, sorts and acts. A mismatch is a suggestion: the buttons move or
 * request through the same gate functions as everywhere else, and snoozing only hides a reason from this list (it changes nothing about the initiative).
 */
export function AttentionView({ controller, lookups, me, source, pageHref = (c) => `/portfolio/${encodeURIComponent(c)}`, decisionsHref = "/decisions" }: Props) {
  const router = useRouter();
  const { canEdit } = useWorkspace();
  const { rows } = useViewRows(controller, me);
  const today = controller.todayDate();
  const todayIso = useMemo(() => today.toISOString().slice(0, 10), [today]);
  const [requests, setRequests] = useState<GateRequest[]>([]);
  const [conditions, setConditions] = useState<{ item_id: string; text: string }[]>([]);
  const [snoozes, setSnoozes] = useState<Snooze[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choice, setChoice] = usePersisted<Choice>("pv.attention.choice.v1", NO_CHOICE, isChoice);
  const [hidden, setHidden] = usePersisted<string[]>("pv.attention.hidden.v1", DEFAULT_HIDDEN, (v): v is string[] => Array.isArray(v));
  const [layout, setLayout] = usePersisted<{ id: string; w: number }[]>("pv.attention.layout.v1", [], (v): v is { id: string; w: number }[] => Array.isArray(v));
  const [active, setActive] = useState<string | null>(null);
  const [peek, setPeek] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [gateFor, setGateFor] = useState<{ gate: GateId; ids: string[] } | null>(null);
  const [snoozeFor, setSnoozeFor] = useState<AttentionGridRow[] | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string; undo?: () => void } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const api = useRef<GridApi<AttentionGridRow> | null>(null);
  const undoStack = useRef<(() => Promise<void>)[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  useEffect(() => {
    let off = false;
    Promise.all([source.loadRequests(), source.loadOpenConditions(), source.loadSnoozes().catch(() => [] as Snooze[])]).then(
      ([r, c, z]) => { if (!off) { setRequests(r); setConditions(c); setSnoozes(z); setLoadError(null); } },
      (e: Error) => { if (!off) setLoadError(e.message); },
    );
    return () => { off = true; };
  }, [source, reload]);

  const entries = useMemo(() => attentionList(rows, today, { requests, conditions, snoozes }), [rows, today, requests, conditions, snoozes]);
  const all = useMemo(() => attentionGridRows(entries, rows, {
    today,
    person: (id) => lookups.members.find((m) => m.user_id === id)?.email.split("@")[0] ?? "",
    project: (id) => lookups.projects.find((p) => p.id === id)?.name ?? "",
  }), [entries, rows, today, lookups]);
  const filters: AttentionFilters = useMemo(() => ({ kinds: choice.kinds, urgencies: choice.urgencies, phases: choice.phases, healths: choice.healths, groups: choice.groups, search: choice.search, showSnoozed: choice.showSnoozed, actionable: choice.actionable }), [choice]);
  const shown = useMemo(() => filterAttentionRows(all, filters).sort(byTier), [all, filters]);
  const live = useMemo(() => all.filter((r) => !r.snoozed), [all]);
  const snoozedCount = all.length - live.length;
  const chips = useMemo(() => kindCounts(filterAttentionRows(all, { ...filters, kinds: [] })), [all, filters]);
  const phases = useMemo(() => facetCounts(live, (r) => r.phase || "No phase").map((o) => ({ ...o, value: o.value })), [live]);
  const healths = useMemo(() => facetCounts(live, (r) => r.health || "No health"), [live]);
  const groups = useMemo(() => facetCounts(live, (r) => r.group || "No group"), [live]);
  const counts = useMemo(() => attentionCounts(entries), [entries]);
  const urgentCount = live.filter((r) => r.tier === 0).length;
  const touched = JSON.stringify({ ...choice, search: "" }) !== JSON.stringify({ ...NO_CHOICE }) || choice.search !== "";

  const changed = useCallback(() => { void controller.refreshFromServer(); setReload((n) => n + 1); }, [controller]);
  const say = (ok: boolean, text: string, undo?: () => void) => setMessage({ ok, text, ...(undo ? { undo } : {}) });
  const set = (patch: Partial<Choice>) => { setChoice((c) => ({ ...c, ...patch })); setPicked([]); };

  const run = useCallback(async (row: AttentionGridRow, a: AttentionAction) => {
    setMessage(null);
    if (a.type === "decisions") { router.push(decisionsHref); return; }
    if (a.type === "request-gate") { setGateFor({ gate: a.gate, ids: [row.id] }); return; }
    setBusy(row.id);
    const r = await source.move(row.id, a.to);
    setBusy(null);
    if (r.ok) { say(true, `${row.code} moved to ${a.to}.`); changed(); } else say(false, `${row.code} was not moved: ${r.error}`);
  }, [router, decisionsHref, source, changed]);

  // ---- snooze, dismiss, bring back (with undo)
  const applySnooze = async (targets: AttentionGridRow[], until: string | null, note: string) => {
    const kinds = new Set<AttentionKind>(targets.flatMap((t) => t.kinds));
    const before = snoozes.filter((z) => targets.some((t) => t.id === z.item_id));
    for (const k of kinds) {
      const ids = targets.filter((t) => t.kinds.includes(k)).map((t) => t.id);
      const r = await source.snooze(ids, k, until, note);
      if (!r.ok) { say(false, `Not snoozed: ${r.error}`); setSnoozeFor(null); return; }
    }
    const undo = async () => {
      for (const k of kinds) {
        const ids = targets.filter((t) => t.kinds.includes(k)).map((t) => t.id);
        const had = before.filter((z) => z.kind === k);
        await source.unsnooze(ids, k);
        for (const z of had) await source.snooze([z.item_id], k, z.snoozed_until, z.note ?? undefined);
      }
      setReload((n) => n + 1);
    };
    undoStack.current.push(undo); setCanUndo(true);
    setSnoozeFor(null); setPicked([]); api.current?.deselectAll();
    say(true, `${targets.length === 1 ? targets[0]!.code : `${targets.length} initiatives`} ${until ? `snoozed until ${until}` : "dismissed"}. It only hides the reason from this list.`, () => void doUndo());
    setReload((n) => n + 1);
  };
  const doUndo = async () => { const u = undoStack.current.pop(); setCanUndo(undoStack.current.length > 0); if (u) { await u(); say(true, "Undone."); } };
  const bringBack = async (targets: AttentionGridRow[]) => {
    const before = snoozes.filter((z) => targets.some((t) => t.id === z.item_id));
    const kinds = new Set(before.map((z) => z.kind));
    for (const k of kinds) {
      const r = await source.unsnooze(before.filter((z) => z.kind === k).map((z) => z.item_id), k);
      if (!r.ok) { say(false, `Not brought back: ${r.error}`); return; }
    }
    undoStack.current.push(async () => { for (const z of before) await source.snooze([z.item_id], z.kind, z.snoozed_until, z.note ?? undefined); setReload((n) => n + 1); }); setCanUndo(true);
    say(true, `${targets.length === 1 ? targets[0]!.code : `${targets.length} initiatives`} back on the list.`, () => void doUndo());
    setPicked([]); api.current?.deselectAll(); setReload((n) => n + 1);
  };

  // ---- the selection
  const selected = useMemo(() => shown.filter((r) => picked.includes(r.id)), [shown, picked]);
  const { movable } = useMemo(() => bulkMoveSplit(selected.filter((r) => !r.snoozed)), [selected]);
  const gateGroups = useMemo(() => {
    const g = new Map<GateId, AttentionGridRow[]>();
    for (const r of selected) for (const a of r.actions) if (a.action.type === "request-gate") g.set(a.action.gate, [...(g.get(a.action.gate) ?? []), r]);
    return [...g];
  }, [selected]);
  const bulkMove = async () => {
    setBulkBusy(true); setMessage(null);
    const res = await Promise.all(movable.map(async (r) => ({ r, out: await source.move(r.id, "Test") })));
    setBulkBusy(false);
    const failed = res.filter((x) => !x.out.ok);
    const ok = res.length - failed.length;
    say(failed.length === 0, `${ok} moved to Test${failed.length ? `, ${failed.length} not moved: ${failed.map((f) => `${f.r.code} (${(f.out as { error: string }).error})`).join("; ")}` : ""}.`);
    api.current?.deselectAll(); setPicked([]); changed();
  };

  // ---- keys: J and K walk the list, Enter peeks, X selects, Z snoozes, M does the main step, / searches, Ctrl+Z undoes a snooze
  const activeRow = shown.find((r) => r.id === active) ?? null;
  const setActiveAndShow = (id: string | null) => {
    setActive(id);
    const node = id ? api.current?.getRowNode(id) : null;
    if (node?.rowIndex != null) api.current?.ensureIndexVisible(node.rowIndex);
    api.current?.redrawRows();
  };
  useEffect(() => {
    const h = (ev: KeyboardEvent) => {
      if (gateFor || snoozeFor) return;
      if ((ev.target as HTMLElement).closest("input, textarea, select, button, a, [role=dialog], .lst-panel")) return;
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "z" && !ev.shiftKey) { if (undoStack.current.length > 0) { ev.preventDefault(); void doUndo(); } return; }
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const i = shown.findIndex((x) => x.id === active);
      if (ev.key === "j" || ev.key === "ArrowDown") { ev.preventDefault(); setActiveAndShow(shown[Math.min(shown.length - 1, i + 1)]?.id ?? null); }
      else if (ev.key === "k" || ev.key === "ArrowUp") { ev.preventDefault(); setActiveAndShow(shown[Math.max(0, i - 1)]?.id ?? null); }
      else if (ev.key === "Enter" && i >= 0) { ev.preventDefault(); setPeek(shown[i]!.id); }
      else if (ev.key === "Escape") { if (peek) setPeek(null); }
      else if (ev.key === "x" && i >= 0) { ev.preventDefault(); api.current?.getRowNode(shown[i]!.id)?.setSelected(!api.current.getRowNode(shown[i]!.id)!.isSelected()); }
      else if (ev.key === "z" && i >= 0 && canEdit) { ev.preventDefault(); setSnoozeFor([shown[i]!]); }
      else if (ev.key === "m" && i >= 0 && shown[i]!.actions[0]) { ev.preventDefault(); void run(shown[i]!, shown[i]!.actions[0]!.action); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // doUndo and setActiveAndShow only read refs and state listed here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, active, gateFor, snoozeFor, peek, canEdit, run]);

  // ---- the grid
  const ctx: Ctx = useMemo(() => ({
    open: (id) => { setActive(id); setPeek(id); }, run: (r, a) => void run(r, a), snoozeOne: (r) => setSnoozeFor([r]), unsnoozeOne: (r) => void bringBack([r]), busy, canEdit, today: todayIso,
    // bringBack reads the latest snoozes through the closure below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [run, busy, canEdit, todayIso, snoozes]);
  const cols = useMemo<ColDef<AttentionGridRow>[]>(() => {
    const d = (id: ColumnId, def: ColDef<AttentionGridRow>): ColDef<AttentionGridRow> => ({ colId: id, sortable: true, ...def });
    return [
      { colId: "initiative", headerName: "Initiative", field: "name", width: 330, cellRenderer: NameCell, sortable: true, pinned: "left", comparator: (_a, _b, x, y) => x.data!.code.localeCompare(y.data!.code, undefined, { numeric: true }) },
      d("urgency", { headerName: "Urgency", field: "tier", width: 110, cellRenderer: UrgencyCell, sort: undefined }),
      d("reasons", { headerName: "Reasons", field: "reasonLabels", width: 270, cellRenderer: ReasonsCell }),
      d("why", { headerName: "What is wrong", field: "reasonText", flex: 1, minWidth: 260, tooltipField: "reasonText" }),
      d("phase", { headerName: "Phase", field: "phase", width: 110, valueFormatter: (p) => p.value || "No phase" }),
      d("health", { headerName: "Health", field: "health", width: 120, cellRenderer: HealthCell }),
      d("build", { headerName: "Build status", field: "buildStatus", width: 130 }),
      d("inPhase", { headerName: "Days in phase", field: "daysInPhase", width: 120, type: "rightAligned", comparator: cmpNum, valueFormatter: (p) => (p.value == null ? "" : String(p.value)) }),
      d("waiting", { headerName: "Days waiting", field: "daysWaiting", width: 120, type: "rightAligned", comparator: cmpNum, headerTooltip: "Days a gate request has waited for a decision", valueFormatter: (p) => (p.value == null ? "" : String(p.value)) }),
      d("group", { headerName: "Initiative group", field: "group", width: 150 }),
      d("project", { headerName: "Project", field: "project", width: 140 }),
      d("owner", { headerName: "Product manager", field: "owner", width: 150 }),
      d("rank", { headerName: "Stack rank", field: "rank", width: 110, type: "rightAligned" }),
      { colId: "action", headerName: "Next step", width: 250, cellRenderer: ActionCell, pinned: "right", sortable: false, resizable: false },
    ];
  }, []);
  // urgency sorts by tier then stack rank: the order of the list, and the order a person expects
  useEffect(() => { api.current?.setColumnsVisible(COLUMN_NAMES.map((c) => c.id), true); api.current?.setColumnsVisible(hidden.filter((h): h is ColumnId => COLUMN_NAMES.some((c) => c.id === h)), false); }, [hidden]);
  const onReady = (e: GridReadyEvent<AttentionGridRow>) => {
    api.current = e.api;
    e.api.setColumnsVisible(hidden, false);
    if (layout.length > 0) e.api.applyColumnState({ state: layout.map((l) => ({ colId: l.id, width: l.w })), applyOrder: true });
  };
  const saveLayout = () => { const st = api.current?.getColumnState(); if (st) setLayout(st.filter((s) => s.colId !== "ag-Grid-SelectionColumn").map((s) => ({ id: s.colId, w: Math.round(s.width ?? 120) }))); };
  const onSelection = (e: SelectionChangedEvent<AttentionGridRow>) => setPicked(e.api.getSelectedRows().map((r) => r.id));

  const exportCsv = () => downloadText(`needs-attention-${todayIso}.csv`, attentionCsv(selected.length > 0 ? selected : shown));
  const gateItems = gateFor ? gateFor.ids.map((id) => controller.row(id)).filter(Boolean) : [];

  return (
    <div className={`attention lst${peek ? " lst-has-peek" : ""}`}>
      <div className="page-head">
        <h1>Needs attention</h1>
        <p className="muted">What to look at in the initiatives you can see, why, and the next step. These are suggestions: nothing changes until you press a button.</p>
      </div>

      <div className="lst-summary" role="status">
        <strong>{live.length}</strong> need attention{urgentCount > 0 && <> · <span className="pill tone-bad">{urgentCount} Urgent</span></>}
        {" "}· showing {shown.length}{snoozedCount > 0 && <> · {snoozedCount} snoozed or dismissed</>}
      </div>

      <div className="lst-bar">
        <ListSearch value={choice.search} onChange={(v) => setChoice((c) => ({ ...c, search: v }))} placeholder="Search initiatives, reasons, people…  ( / )" label="Search Needs attention" />
        <MultiFilter label="Urgency" options={URGENCIES.map((u) => ({ value: u, count: live.filter((r) => r.urgency === u).length }))} selected={choice.urgencies} onChange={(v) => set({ urgencies: v })} />
        <MultiFilter label="Phase" options={phases} selected={choice.phases} onChange={(v) => set({ phases: v })} />
        <MultiFilter label="Health" options={healths} selected={choice.healths} onChange={(v) => set({ healths: v })} />
        <MultiFilter label="Group" options={groups} selected={choice.groups} onChange={(v) => set({ groups: v })} />
        <label className="lst-check"><input type="checkbox" checked={choice.actionable} onChange={(e) => set({ actionable: e.target.checked })} /> One click away</label>
        <label className="lst-check"><input type="checkbox" checked={choice.showSnoozed} onChange={(e) => set({ showSnoozed: e.target.checked })} /> Show snoozed{snoozedCount > 0 ? ` (${snoozedCount})` : ""}</label>
        <span className="lst-spacer" />
        <SavedViews storeKey="pv.attention.views.v1" current={choice} onApply={(s) => { setChoice({ ...NO_CHOICE, ...s }); setPicked([]); }} builtIn={BUILT_IN_VIEWS} />
        <ColumnPicker columns={COLUMN_NAMES} hidden={hidden} onChange={setHidden} onReset={() => { setHidden(DEFAULT_HIDDEN); setLayout([]); }} />
        <button type="button" className="lst-btn" onClick={exportCsv} disabled={shown.length === 0} title={selected.length > 0 ? "Download the selected rows" : "Download the rows shown"}>Download CSV</button>
        {touched && <button type="button" className="link-button" onClick={() => { setChoice(NO_CHOICE); setPicked([]); }}>Clear filters</button>}
      </div>

      <div className="view-chips lst-chips" role="group" aria-label="Filter by reason">
        <button type="button" className={choice.kinds.length === 0 ? "view-chip view-chip-on" : "view-chip"} aria-pressed={choice.kinds.length === 0} onClick={() => set({ kinds: [] })}>All ({filterAttentionRows(all, { ...filters, kinds: [] }).length})</button>
        {ATTENTION_KINDS.filter((k) => chips[k.id] > 0 || choice.kinds.includes(k.id)).map((k) => (
          <button key={k.id} type="button" className={choice.kinds.includes(k.id) ? "view-chip view-chip-on" : "view-chip"} aria-pressed={choice.kinds.includes(k.id)} title={k.hint}
            onClick={() => set({ kinds: choice.kinds.includes(k.id) ? choice.kinds.filter((x) => x !== k.id) : [...choice.kinds, k.id] })}>{k.label} ({chips[k.id]})</button>
        ))}
        {ATTENTION_KINDS.some((k) => counts[k.id] === 0) && <span className="muted lst-zero">No initiative has: {ATTENTION_KINDS.filter((k) => counts[k.id] === 0).map((k) => k.label).join(", ")}</span>}
      </div>

      {loadError && <p role="alert" className="error">Gate requests, conditions or snoozes could not be read ({loadError}); the other reasons are still shown.</p>}
      {message && <p role={message.ok ? "status" : "alert"} className={message.ok ? "quick-add-ok" : "error"}>{message.text} {message.undo && <button type="button" className="link-button" onClick={message.undo}>Undo</button>}</p>}

      {picked.length > 0 && (
        <div className="bulk-bar" role="region" aria-label="Act on the selected initiatives">
          <strong className="bulk-count">{picked.length} selected</strong>
          {movable.length > 0 && <button type="button" className="bulk-btn bulk-btn-open" disabled={bulkBusy || !canEdit} onClick={() => void bulkMove()}>{bulkBusy ? "Moving…" : `Move ${movable.length} to Test`}</button>}
          {gateGroups.map(([g, rs]) => <button key={g} type="button" className="bulk-btn" disabled={!canEdit} onClick={() => setGateFor({ gate: g, ids: rs.map((r) => r.id) })}>Request gate {g} ({rs.length})</button>)}
          {canEdit && selected.some((r) => !r.snoozed) && <button type="button" className="bulk-btn" onClick={() => setSnoozeFor(selected.filter((r) => !r.snoozed))}>Snooze or dismiss…</button>}
          {canEdit && selected.some((r) => r.snoozed) && <button type="button" className="bulk-btn" onClick={() => void bringBack(selected.filter((r) => r.snoozed))}>Bring back</button>}
          <button type="button" className="bulk-btn" onClick={() => { api.current?.deselectAll(); setPicked([]); }}>Clear selection</button>
        </div>
      )}

      <div className="lst-body">
        {shown.length === 0 ? (
          <p className="muted" role="status">{all.length === 0 ? "Nothing needs attention." : "Nothing matches the filters."}</p>
        ) : (
          <div className="lst-grid" data-testid="attention-grid" role="region" aria-label="Initiatives that need attention">
            <AgGridReact<AttentionGridRow>
              theme={GRID_THEME} rowData={shown} columnDefs={cols} getRowId={(p) => p.data.id} context={ctx} defaultColDef={{ ...DEFAULT_COL_DEF, suppressHeaderMenuButton: true }}
              rowSelection={{ mode: "multiRow", checkboxes: true, headerCheckbox: true, enableClickSelection: false }} onSelectionChanged={onSelection} onGridReady={onReady}
              onColumnMoved={(e) => { if (e.finished && e.source !== "api") saveLayout(); }} onColumnResized={(e) => { if (e.finished && e.source === "uiColumnResized") saveLayout(); }}
              getRowClass={(p) => (p.data && p.data.id === active ? "lst-active" : p.data?.snoozed ? "lst-snoozed" : undefined)} onRowClicked={(e) => { if (e.data && !(e.event?.target as HTMLElement | null)?.closest("button, a, input")) setActive(e.data.id); }}
              onRowDoubleClicked={(e) => e.data && setPeek(e.data.id)} tooltipShowDelay={500} suppressColumnVirtualisation suppressCellFocus rowHeight={38}
            />
          </div>
        )}
        {peek && controller.row(peek) && (
          <ItemPanel controller={controller} lookups={lookups} itemId={peek} me={me} mode="peek" onClose={() => setPeek(null)} pageHref={pageHref} gates={source} />
        )}
      </div>
      <p className="muted lst-foot">
        Keys: J and K move, Enter opens the initiative beside the list, X selects, M does the main next step, Z snoozes, / searches{canUndo ? ", Ctrl+Z undoes a snooze" : ""}. Click a header to sort. Time in a phase is for the initiative, never for a person.
        {activeRow ? ` Active: ${activeRow.code}.` : ""}
      </p>

      {gateFor && gateItems.length > 0 && <RequestGateDialog source={source} me={me} items={gateItems as never[]} initialGate={gateFor.gate} onClose={() => setGateFor(null)} onDone={() => { setGateFor(null); api.current?.deselectAll(); setPicked([]); changed(); }} />}
      {snoozeFor && <SnoozeDialog rows={snoozeFor} today={todayIso} onClose={() => setSnoozeFor(null)} onSnooze={(until, note) => void applySnooze(snoozeFor, until, note)} />}
    </div>
  );
}

/** How long to hide the reasons of these initiatives from the list, or to dismiss them until someone brings them back. */
function SnoozeDialog({ rows, today, onClose, onSnooze }: { rows: AttentionGridRow[]; today: string; onClose: () => void; onSnooze: (until: string | null, note: string) => void }) {
  const [days, setDays] = useState<number | "never" | "date">(7);
  const [date, setDate] = useState(snoozeDate(today, 7));
  const [note, setNote] = useState("");
  const until = days === "never" ? null : days === "date" ? date : snoozeDate(today, days);
  const bad = days === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(date) || (until !== null && until <= today);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  return (
    <div className="dialog-backdrop" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div className="dialog dialog-narrow gate-dialog" role="dialog" aria-modal="true" aria-label={`Snooze ${rows.length === 1 ? rows[0]!.code : `${rows.length} initiatives`}`}>
        <h2>Snooze {rows.length === 1 ? `${rows[0]!.code} ${rows[0]!.name}` : `${rows.length} initiatives`}</h2>
        <p className="muted">This hides the reasons from Needs attention for everyone in the workspace. It changes nothing about the initiative, and a reason that is new later still shows.</p>
        <fieldset className="lst-radios">
          <legend className="visually-hidden">How long</legend>
          {SNOOZE_CHOICES.map((c, i) => <label key={c.days}><input ref={i === 0 ? first : undefined} type="radio" name="snooze" checked={days === c.days} onChange={() => setDays(c.days)} /> {c.label}</label>)}
          <label><input type="radio" name="snooze" checked={days === "date"} onChange={() => setDays("date")} /> Until <input type="date" value={date} min={snoozeDate(today, 1)} onChange={(e) => { setDate(e.target.value); setDays("date"); }} aria-label="Snooze until" /></label>
          <label><input type="radio" name="snooze" checked={days === "never"} onChange={() => setDays("never")} /> Dismiss until someone brings it back</label>
        </fieldset>
        <label className="lst-note">Why (optional) <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="For example: waiting for the vendor" /></label>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={bad} onClick={() => onSnooze(until, note)}>{until ? `Snooze until ${until}` : "Dismiss"}</button>
        </div>
      </div>
    </div>
  );
}
