"use client";

import {
  CARDS_DEFAULT_VIEWS, CARDS_VIEW_NAMES, axisLabel, axisOptions, boardMoves, buildBoard, cardColumns, cardFieldKeys, cardNeighbor,
  cardValue, defaultColumnField, healthSegments, matchesFilters, matchesSearch, moveNeedsGate, planMove, refKey, sanitizeView, sizeSummary, type AxisCtx, type Board, type Filter, type ViewDef,
} from "@pv/domain";
import type { GateSource } from "../gates/gate-source";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChoiceMenu } from "../portfolio/choice-menu";
import type { PortfolioController } from "../portfolio/controller";
import { FilterPanel } from "../portfolio/filter-panel";
import { baseDef, baseParam, parseBase, sameView, type BaseView } from "../portfolio/grid-view";
import { ItemPanel } from "../portfolio/item-panel";
import { StatusStrip, useStatus } from "../portfolio/status-strip";
import type { GridItem, Lookups } from "../portfolio/types";
import { baseToRef, useViews, ViewBar } from "../portfolio/view-bar";
import { summarize } from "../portfolio/view-controls";
import { useWorkspace } from "../workspace/provider";
import { setQueryParam, useScope } from "../workspace/scope";
import { statusTone } from "../../components/status-tone";
import { CardFace, healthStripe, type TrackerRef } from "./card-face";
import { CardFieldsPanel } from "./card-fields-panel";

const DEFAULT_LANE = "theme";
const PRIORITISATION: BaseView = { kind: "builtin", name: "Prioritisation" };
const CARDS_VIEW_STORAGE_KEY = "pv:cards-view";

function readStoredCardsView(): string | null {
  if (typeof window === "undefined") return null;
  try { return window.sessionStorage.getItem(CARDS_VIEW_STORAGE_KEY); } catch { return null; }
}

function writeStoredCardsView(param: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (param === null) window.sessionStorage.removeItem(CARDS_VIEW_STORAGE_KEY);
    else window.sessionStorage.setItem(CARDS_VIEW_STORAGE_KEY, param);
  } catch { /* ignore storage errors */ }
}

export type CardsProps = {
  /** Decision gates: a card dropped on a phase column is a Move to that phase when no gate is crossed. */
  gates?: GateSource; controller: PortfolioController; lookups: Lookups; me: string | null; pageHref?: (code: string) => string };

/** Cards: columns by one field, swimlanes by another; drag a card (or use the keys or the Move menu) to change those fields. */
export function CardsView({ controller, lookups, me, pageHref, gates }: CardsProps) {
  const params = useSearchParams();
  const status = useStatus(controller);
  const { views, defaults, ready } = useWorkspace();
  const scope = useScope();
  const today = controller.todayDate();
  const options = useMemo(() => axisOptions(), []);
  const available = options.filter((o) => o.available);
  const keys = available.map((o) => o.key);

  // ---- the view: 4 default Cards views + custom saved views, persisted in URL (?view=) and session storage
  const [base, setBase] = useState<BaseView>(() => {
    const fromUrl = params.get("view");
    if (fromUrl !== null) return parseBase(fromUrl, PRIORITISATION);
    return parseBase(readStoredCardsView(), PRIORITISATION);
  });
  type Shared = { filters?: Filter[]; groupBy?: string | null; sort?: ViewDef["sort"] };
  const [shared, setShared] = useState<Shared>(() => {
    const v = params.get("lane");
    if (v === "none") return { groupBy: null };
    if (v && keys.includes(v)) return { groupBy: v };
    return {};
  });
  const [colOverrides, setColOverrides] = useState<Record<string, { columns: string[]; pinned: string[] }>>({});
  const viewKey = refKey(baseToRef(base));
  const savedDef = useMemo(() => baseDef(base, views, defaults, CARDS_DEFAULT_VIEWS), [base, views, defaults]);
  const baseMissing = base.kind === "saved" && savedDef === null && ready;
  const bDef = useMemo(() => savedDef ?? baseDef(PRIORITISATION, [], defaults, CARDS_DEFAULT_VIEWS)!, [savedDef, defaults]);
  const co = colOverrides[viewKey];
  const def = useMemo(
    () => sanitizeView({
      ...bDef,
      ...(co ? { columns: co.columns, pinned: co.pinned } : {}),
      ...(shared.filters !== undefined ? { filters: shared.filters } : {}),
      ...("groupBy" in shared ? { groupBy: shared.groupBy } : {}),
      ...("sort" in shared ? { sort: shared.sort } : {}),
    }),
    [bDef, co, shared],
  );
  const dirty = !sameView(def, bDef);

  useEffect(() => {
    const p = baseParam(base);
    writeStoredCardsView(p);
    if (params.get("view") === null && p !== null) setQueryParam("view", p);
  }, [base, params]);

  const openBaseRaw = (b: BaseView) => {
    const target = baseDef(b, views, defaults, CARDS_DEFAULT_VIEWS);
    if (target) {
      setShared((p) => {
        const n = { ...p };
        if (target.filters.length > 0 || b.kind === "builtin") delete n.filters;
        delete n.groupBy;
        if (target.sort) delete n.sort;
        return n;
      });
    }
    setBase(b);
    const p = baseParam(b);
    setQueryParam("view", p);
    setQueryParam("lane", null);
    writeStoredCardsView(p);
  };
  const changeDef = (patch: Partial<ViewDef>) => {
    const next = sanitizeView({ ...def, ...patch });
    setShared((p) => ({ ...p, ...("filters" in patch ? { filters: next.filters } : {}), ...("groupBy" in patch ? { groupBy: next.groupBy } : {}), ...("sort" in patch ? { sort: next.sort ?? [] } : {}) }));
    if ("columns" in patch || "pinned" in patch) setColOverrides((p) => ({ ...p, [viewKey]: { columns: next.columns, pinned: next.pinned ?? [] } }));
  };
  const clearColumns = () => setColOverrides((p) => { const n = { ...p }; delete n[viewKey]; return n; });
  const resetChanges = () => { setShared({}); clearColumns(); setQueryParam("lane", null); };
  const viewsApi = useViews({
    base, def, bDef, dirty, openBase: openBaseRaw, discard: clearColumns, reset: resetChanges,
    builtins: CARDS_VIEW_NAMES, defaultBar: CARDS_VIEW_NAMES, builtinDefs: CARDS_DEFAULT_VIEWS,
  });

  const [search, setSearch] = useState("");
  const setFilters = (filters: Filter[]) => changeDef({ filters });

  const [colField, setColState] = useState(() => { const v = params.get("by"); return v && keys.includes(v) ? v : defaultColumnField(); });
  const laneField = def.groupBy && keys.includes(def.groupBy) ? def.groupBy : "";
  const setCol = (v: string) => { setColState(v); setQueryParam("by", v === defaultColumnField() ? null : v); };
  const setLane = (v: string) => {
    changeDef({ groupBy: v || null });
    setQueryParam("lane", v === DEFAULT_LANE ? null : v === "" ? "none" : v);
  };

  const rows = useMemo<GridItem[]>(
    () => controller.rows.filter((r) => (scope.projectIds === null || scope.projectIds.includes(r.home_project)) && matchesSearch(r, search, (id) => lookups.members.find((m) => m.user_id === id)?.email ?? "") && matchesFilters(r, def.filters, { me, today })),
    // the controller changes its rows in place; the version says when
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, status.version, scope.projectIds, search, def.filters, me],
  );
  const filterName = base.kind === "saved" ? (views.find((v) => v.id === base.id)?.name ?? null) : base.kind === "builtin" && def.filters.length > 0 ? base.name : null;

  const [peekId, setPeekState] = useState<string | null>(() => { const c = params.get("item"); return c ? controller.rows.find((r) => r.item_code === c)?.id ?? null : null; });
  const openPeek = useCallback((id: string | null) => { setPeekState(id); setQueryParam("item", id ? controller.row(id)?.item_code ?? null : null); }, [controller]);

  const canEdit = controller.canEdit;
  const colOpt = options.find((o) => o.key === colField)!;
  const laneOpt = laneField ? options.find((o) => o.key === laneField) : undefined;

  const teamNames = useMemo(() => (lookups.teams ?? []).map((t) => t.name), [lookups.teams]);
  const ctx = useMemo<AxisCtx>(() => ({
    groups: controller.groupNames(), projects: lookups.projects, teams: teamNames,
    teamsOf: (r) => { const t = typeof r.contributing_teams === "string" ? r.contributing_teams.split(/,\s*/) : []; return teamNames.filter((n) => t.includes(n)); },
    // the group list grows as groups are typed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [controller, status.version, lookups.projects, teamNames]);
  const board = useMemo<Board>(() => buildBoard(rows, colField, laneField || null, ctx), [rows, colField, laneField, ctx]);
  const rowOf = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const moves = useMemo(() => boardMoves(board), [board]);

  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const [announce, setAnnounce] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  // a click anywhere outside the open Move menu (or its button) closes it
  useEffect(() => {
    if (!menuFor && !actionsFor) return;
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".kc-menu")) setMenuFor(null);
      if (!t.closest(".kc-actions, .kc-more")) setActionsFor(null);
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [menuFor, actionsFor]);
  // a moved card is a new element in another cell: give it the focus again once the board has been drawn
  const refocus = useCallback((id: string) => {
    requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-card="${id}"]`)?.focus()));
  }, []);

  const lockReason = !canEdit ? "You have view-only access, so cards cannot be moved." : null;

  /** Move a card to a cell (a drop, a Shift+arrow or the Move menu): checks the rules, then one undo step. */
  const moveTo = useCallback((id: string, toCol: string, toLane: string) => {
    const row = rowOf.get(id);
    if (!row) return;
    if (lockReason) { controller.notify(lockReason); setAnnounce(lockReason); return; }
    const plan = planMove(row, { colField, laneField: laneField || null, toCol, toLane }, ctx);
    if (!plan.ok) { controller.notify(plan.error); setAnnounce(`${row.item_code} was not moved: ${plan.error}`); return; }
    if (Object.keys(plan.changes).length === 0) return;
    // a card dropped on a phase column is a Move to that phase (no gate crossed) or a refusal that names the gate; it is not an undo step
    if ("initiative_phase" in plan.changes) {
      const { initiative_phase: toPhase, ...rest } = plan.changes;
      const refuse = (text: string) => { controller.notify(text); setAnnounce(`${row.item_code} was not moved: ${text}`); };
      if (!gates) { refuse("Initiative Phase moves through a decision gate or Move to next phase."); return; }
      if (toPhase === null || toPhase === undefined) { refuse("A phase cannot be cleared. Move the card to another phase."); return; }
      if (toPhase === "Completed") { refuse("Set Initiative Status to Completed; the phase follows."); return; }
      const need = moveNeedsGate(row.initiative_phase, toPhase as never);
      if (need) { refuse(`This move passes decision gate ${need}. Request it from the item panel or the bulk bar of the grid.`); return; }
      if (Object.keys(rest).length > 0) controller.editFields(id, rest);
      void gates.move(id, String(toPhase)).then((m) => {
        if (m.ok) { void controller.refreshFromServer(); setAnnounce(`${row.item_code} moved to ${String(toPhase)}.`); }
        else refuse(m.error);
      });
      return;
    }
    const r = controller.editFields(id, plan.changes);
    setAnnounce(r.ok ? `${controller.status.last?.text ?? `${row.item_code} moved`}. Undo with Ctrl+Z.` : `${row.item_code} was not moved: ${r.error}`);
  }, [rowOf, colField, laneField, ctx, controller, lockReason, gates]);

  // Ctrl/Cmd+Z undoes the last move; Shift+Z or Y redoes it; not while typing
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]")) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); void controller.undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); void controller.redo(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [controller]);
  useEffect(() => {
    if (!peekId) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || menuFor) return;
      if ((e.target as HTMLElement).closest("input, textarea, select, [role=dialog], [role=menu]")) return;
      openPeek(null);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [peekId, openPeek, menuFor]);

  const memberName = (id: unknown) => { const e = lookups.members.find((m) => m.user_id === id)?.email; return e ? e.split("@")[0]! : ""; };
  // the fields on a card: the view's columns that a card can draw, at most five, none repeating the board's own columns or swimlanes
  const axes = useMemo(() => [colField, laneField].filter(Boolean), [colField, laneField]);
  const cardFields = useMemo(() => cardFieldKeys(def.columns, axes), [def.columns, axes]);
  const defaultCardFields = useMemo(() => cardFieldKeys(bDef.columns, axes), [bDef.columns, axes]);
  const applyCardFields = (chosen: string[]) => changeDef({ columns: cardColumns(chosen), pinned: [] });
  const trackersOf = (id: string): TrackerRef[] => {
    const out: TrackerRef[] = [];
    const gh = lookups.github?.links[id];
    if (gh && gh.number != null) out.push({ tracker: "github", label: `#${gh.number}`, url: gh.url });
    const jira = lookups.jira?.links[id];
    if (jira?.issueKey) out.push({ tracker: "jira", label: jira.issueKey, url: jira.url });
    return out;
  };
  const copyLink = (code: string) => {
    const u = new URL(window.location.href);
    u.searchParams.set("item", code);
    void navigator.clipboard?.writeText(u.href).then(() => controller.notify(`Link to ${code} copied.`), () => controller.notify("Could not copy the link."));
  };

  const onCardKey = (e: React.KeyboardEvent, row: GridItem) => {
    if (e.key === "Enter" || e.key === " ") { if ((e.target as HTMLElement).closest("button")) return; e.preventDefault(); openPeek(row.id); return; }
    if (e.key === "m" || e.key === "M") { if (!e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); setMenuFor(row.id); } return; }
    if (e.key === "Escape" && menuFor === row.id) { e.stopPropagation(); setMenuFor(null); return; }
    const dir = e.key === "ArrowLeft" ? "left" : e.key === "ArrowRight" ? "right" : e.key === "ArrowUp" ? "up" : e.key === "ArrowDown" ? "down" : null;
    if (!dir || !e.shiftKey) return;
    e.preventDefault();
    const cur = { col: cardValue(row, colField, ctx), lane: laneField ? cardValue(row, laneField, ctx) : "" };
    const to = cardNeighbor(board, cur.col, cur.lane, dir);
    if (!to) { setAnnounce(`${row.item_code} is already at the edge of the board.`); return; }
    moveTo(row.id, to.col, to.lane);
    refocus(row.id);
  };

  const renderCard = (id: string) => {
    const row = rowOf.get(id);
    if (!row) return null;
    const health = row.health ? String(row.health) : "";
    const owner = memberName(row.product_manager);
    const menuOpen = actionsFor === id;
    return (
      <div
        key={id} className={`kcard${dragging === id ? " kcard-dragging" : ""}`} data-card={id} data-stripe={healthStripe(health)} tabIndex={0} role="group"
        aria-label={`${row.item_code} ${row.initiative_name}, rank ${row.stack_rank}${health ? `, health ${health}` : ""}. Shift and arrow keys move it, M opens the move menu, Enter opens it.`}
        draggable={canEdit} onDragStart={(e) => { e.dataTransfer.setData("text/plain", id); e.dataTransfer.effectAllowed = "move"; setDragging(id); setActionsFor(null); }}
        onDragEnd={() => { setDragging(null); setOver(null); }}
        onClick={(e) => { if (!(e.target as HTMLElement).closest("button, select, a")) openPeek(id); }} onKeyDown={(e) => onCardKey(e, row)}
      >
        <CardFace
          row={row} fields={cardFields} owner={owner} ownerTitle={String(lookups.members.find((m) => m.user_id === row.product_manager)?.email ?? "")}
          trackers={trackersOf(id)} today={today} onOpen={() => openPeek(id)}
          actions={(
            <button type="button" className="kc-more" aria-label={`Actions for ${row.item_code}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={(e) => { e.stopPropagation(); setActionsFor(menuOpen ? null : id); }}>
              <span aria-hidden="true">⋯</span>
            </button>
          )}
        />
        {menuOpen && (
          <div className="kc-actions" role="menu" aria-label={`Actions for ${row.item_code}`} onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") { setActionsFor(null); refocus(id); } }}>
            <button type="button" role="menuitem" autoFocus onClick={() => { setActionsFor(null); openPeek(id); }}>Open</button>
            {canEdit && <button type="button" role="menuitem" aria-label={`Move ${row.item_code}…`} onClick={() => { setActionsFor(null); setMenuFor(id); }}>Move…</button>}
            <button type="button" role="menuitem" onClick={() => { setActionsFor(null); copyLink(row.item_code); }}>Copy link</button>
          </div>
        )}
        {menuFor === id && <MoveMenu row={row} moves={moves} colField={colField} laneField={laneField} ctx={ctx} onMove={(c, l) => { setMenuFor(null); moveTo(id, c, l); refocus(id); }} onClose={() => { setMenuFor(null); refocus(id); }} />}
      </div>
    );
  };

  // per column: the sizes of its cards ("3L 1M"); per lane: the health of its cards
  const columnSizes = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of board.columns) m.set(c.value, sizeSummary(board.lanes.flatMap((l) => (l.cells.get(c.value) ?? []).map((id) => rowOf.get(id)?.effort))));
    return m;
  }, [board, rowOf]);
  const laneHealth = (ids: string[]) => healthSegments(ids.map((id) => rowOf.get(id)?.health));

  const drop = (e: React.DragEvent, toCol: string | null, toLane: string) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/plain");
    const row = rowOf.get(id);
    if (!row) return;
    moveTo(id, toCol ?? cardValue(row, colField, ctx), toLane);
  };

  return (
    <div className="cards-page">
      <div className="gantt-toolbar page-head">
        <div className="head-row">
          <h1>Cards</h1>
          <ViewBar api={viewsApi} />
        </div>
        <p className="muted gantt-count">
          {board.total} initiatives{scope.selection.kind !== "all" ? ` · scope: ${scope.label}` : ""}{filterName ? ` · filters of “${filterName}”` : ""}
        </p>
        {(def.filters.length > 0 || scope.selection.kind !== "all") && (
          <div className="filter-chips" aria-label="Active scope and filters">
            {scope.selection.kind !== "all" && <span className="token-chip">Project: {scope.label}</span>}
            {def.filters.map((f, i) => (
              <span key={i} className="token-chip">
                {summarize(f, lookups)}{" "}
                <button type="button" className="chip-x" aria-label={`Remove filter ${summarize(f, lookups)}`} onClick={() => setFilters(def.filters.filter((_, j) => j !== i))}>×</button>
              </span>
            ))}
          </div>
        )}
        {baseMissing && <div className="view-dirty" role="status">This view is private to its owner or no longer exists. Showing Prioritisation.</div>}
      </div>

      <div className="pvbar" role="region" aria-label="Card tools">
        <div className="pvbar-s1">
          <FilterPanel filters={def.filters} onChange={setFilters} lookups={lookups} quarters={controller.rows.map((r) => r.g2m_quarter)} openValues={(k) => controller.openValues(k)} today={today} matching={rows.length} total={controller.rows.length} />
          <CardFieldsPanel chosen={cardFields} defaultChosen={defaultCardFields} axes={axes} customerSafe={def.customerSafe === true} sample={rows[0]} sampleOwner={rows[0] ? memberName(rows[0].product_manager) : ""} today={today} onApply={applyCardFields} />
          <label className="pvbar-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5b6272" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
            <input
              type="search"
              aria-label="Search initiatives"
              placeholder="Search initiatives"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setSearch(""); }}
            />
          </label>
          <div className="gantt-tools">
            <ChoiceMenu name="Columns" value={colField} choices={options.map((o) => ({ value: o.key, label: o.label, disabled: !o.available }))} onChange={setCol} />
            <ChoiceMenu name="Swimlanes" value={laneField} none="No swimlanes" choices={available.filter((o) => o.key !== colField).map((o) => ({ value: o.key, label: o.label }))} onChange={setLane} />
          </div>
        </div>
      </div>

      <div className={peekId ? "gantt-split gantt-split-open" : "gantt-split"}>
        <div className="gantt-chart cards-chart">
          <StatusStrip controller={controller} />
          {(!colOpt.editable || (laneOpt && !laneOpt.editable)) && (
            <p className="cards-note" role="note">
              {[!colOpt.editable && `Columns: ${colOpt.reason}`, laneOpt && !laneOpt.editable && `Swimlanes: ${laneOpt.reason}`].filter(Boolean).join(" ")} Cards can be moved across the other axis.
            </p>
          )}
          <div className="kb-scroll" data-testid="cards-scroll">
            <div className={dragging ? "kb kb-dragging" : "kb"} style={{ minWidth: board.columns.length * 232 }}>
              <div className="kb-head" style={{ gridTemplateColumns: `repeat(${board.columns.length}, minmax(220px, 1fr))` }}>
                {board.columns.map((c) => (
                  <div key={c.value || "none"} className="kb-col-head">
                    <span className="kb-col-name">{c.label}</span> <span className="gl-count">{board.columnCounts.get(c.value) ?? 0}</span>
                    {columnSizes.get(c.value) && <span className="kb-col-sub" title="Sizes of the cards in this column">{columnSizes.get(c.value)}</span>}
                  </div>
                ))}
              </div>
              {board.lanes.map((lane) => {
                const laneKey = lane.value || "none";
                const collapsed = (lane.count === 0) !== toggled.has(lane.value);
                const showHead = !!laneField;
                return (
                  <section key={laneKey} className="kb-lane" aria-label={laneField ? `${axisLabel(laneField)}: ${lane.label}` : "Cards"}>
                    {showHead && (
                      <div className={`kb-lane-head${over === `lane:${laneKey}` ? " kb-over" : ""}`} data-lane-head={laneKey}
                        onDragOver={(e) => { if (canEdit) { e.preventDefault(); setOver(`lane:${laneKey}`); } }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, null, lane.value)}>
                        <button type="button" className="gl-toggle" aria-expanded={!collapsed} aria-label={`${collapsed ? "Expand" : "Collapse"} ${lane.label}`}
                          onClick={() => setToggled((t) => { const n = new Set(t); if (!n.delete(lane.value)) n.add(lane.value); return n; })}>{collapsed ? "▸" : "▾"}</button>
                        <strong>{lane.label}</strong> <span className="gl-count">{lane.count} {lane.count === 1 ? "item" : "items"}</span>
                        <LaneHealth segments={laneHealth([...lane.cells.values()].flat())} />
                      </div>
                    )}
                    {!collapsed && (
                      <div className="kb-row" style={{ gridTemplateColumns: `repeat(${board.columns.length}, minmax(220px, 1fr))` }}>
                        {board.columns.map((c) => {
                          const cellKey = `${laneKey}|${c.value || "none"}`;
                          return (
                            <div key={cellKey} className={`kb-cell${over === cellKey ? " kb-over" : ""}`} data-lane={laneKey} data-col={c.value || "none"}
                              onDragOver={(e) => { if (canEdit) { e.preventDefault(); setOver(cellKey); } }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, c.value, lane.value)}>
                              {(lane.cells.get(c.value) ?? []).map(renderCard)}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              })}
              {board.total === 0 && <p className="muted cards-empty">No initiatives in this scope.</p>}
            </div>
          </div>
          <p className="gantt-foot muted">
            Columns by {axisLabel(colField)}{laneField ? `, swimlanes by ${axisLabel(laneField)}` : ""} · drag a card to another column or lane to change the field · keys: Shift+arrows move the focused card, M opens the Move menu, Enter opens the card · Ctrl+Z undoes a move
            {lockReason ? ` · ${lockReason}` : ""}
          </p>
          <div className="visually-hidden" role="status" aria-live="polite">{announce}</div>
        </div>
        {peekId && <ItemPanel controller={controller} lookups={lookups} itemId={peekId} me={me} mode="peek" onClose={() => openPeek(null)} pageHref={pageHref} />}
      </div>
    </div>
  );
}

/** A small bar of the health of a lane's cards, with the words next to it (the colours are only an extra). */
function LaneHealth({ segments }: { segments: { health: string; count: number }[] }) {
  const total = segments.reduce((n, x) => n + x.count, 0);
  if (total === 0) return null;
  const text = segments.map((x) => `${x.count} ${x.health}`).join(" · ");
  return (
    <span className="kb-health" title={`Health: ${text}`}>
      <span className="kb-hbar" role="img" aria-label={`Health: ${text}`}>
        {segments.map((x) => <span key={x.health} className={`tone-${x.health === "No health" ? "neutral" : statusTone(x.health)}`} style={{ flexGrow: x.count }} />)}
      </span>
      <span className="muted" aria-hidden="true">{text}</span>
    </span>
  );
}

/** The keyboard (and touch) way to move a card to any cell: two lists and a button. */
function MoveMenu({ row, moves, colField, laneField, ctx, onMove, onClose }: {
  row: GridItem; moves: ReturnType<typeof boardMoves>; colField: string; laneField: string; ctx: AxisCtx;
  onMove: (col: string, lane: string) => void; onClose: () => void;
}) {
  const [col, setCol] = useState(cardValue(row, colField, ctx));
  const [lane, setLane] = useState(laneField ? cardValue(row, laneField, ctx) : "");
  return (
    <div className="kc-menu" role="dialog" aria-label={`Move ${row.item_code}`} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") onClose(); }}>
      <label>{axisLabel(colField)} <select autoFocus value={col} onChange={(e) => setCol(e.target.value)}>{moves.columns.map((c) => <option key={c.value || "none"} value={c.value}>{c.label}</option>)}</select></label>
      {laneField && <label>{axisLabel(laneField)} <select value={lane} onChange={(e) => setLane(e.target.value)}>{moves.lanes.map((c) => <option key={c.value || "none"} value={c.value}>{c.label}</option>)}</select></label>}
      <div className="kc-menu-actions">
        <button type="button" className="btn btn-primary" onClick={() => onMove(col, lane)}>Move</button>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
