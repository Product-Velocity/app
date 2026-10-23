"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  PX_PER_DAY, applyKey, classifyRows, clampWindow, dayToX, defaultWindow, formatDate, fromDay, ganttGroupOptions, layoutLines,
  moveRange, readOnlyReason, resizeRange, scheduleAt, summarizeChange, timelineTicks, xToDay, yearSpans, type Bar, type GanttRow, type Line, type Range, type Zoom,
} from "@pv/domain";
import type { PortfolioController } from "../portfolio/controller";
import { ItemPanel } from "../portfolio/item-panel";
import { StatusStrip } from "../portfolio/status-strip";
import { useViewRows } from "../portfolio/use-view-rows";
import type { GridItem, Lookups } from "../portfolio/types";
import { setQueryParam } from "../workspace/scope";

const LABEL_W = 300;
const LINE_H = 28;
const HEAD_H = 46;
const BUFFER = 8;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, "-");
type DragMode = "move" | "start" | "end";
type Drag = { id: string; mode: DragMode; originX: number; base: Range; current: Range; moved: boolean };

export type GanttProps = {
  controller: PortfolioController;
  lookups: Lookups;
  me: string | null;
  /** Address of an item's page (the test page has its own). */
  pageHref?: (code: string) => string;
};

/** Gantt: one bar per initiative from Planned Start to G2M Date (est), two-level grouping, drag or keys to change the dates. */
export function GanttView({ controller, lookups, me, pageHref }: GanttProps) {
  const params = useSearchParams();
  const { rows, scope, views, viewParam, filterName } = useViewRows(controller, me);
  const today = controller.todayDate();
  const canEdit = controller.canEdit;
  const groupOptions = useMemo(() => ganttGroupOptions(), []);

  // ---- settings kept in the address
  const [zoom, setZoomState] = useState<Zoom>(() => (params.get("zoom") === "quarter" ? "quarter" : "month"));
  const optionKeys = groupOptions.map((o) => o.key);
  const initial = (name: string, fallback: string) => { const v = params.get(name); return v === null ? fallback : optionKeys.includes(v) ? v : fallback; };
  const [g1, setG1State] = useState(() => initial("g1", "theme"));
  const [g2, setG2State] = useState(() => initial("g2", "home_project"));
  const [peekId, setPeekState] = useState<string | null>(() => { const c = params.get("item"); return c ? controller.rows.find((r) => r.item_code === c)?.id ?? null : null; });
  const setZoom = (z: Zoom) => { setZoomState(z); setQueryParam("zoom", z === "month" ? null : z); };
  const setG1 = (g: string) => { setG1State(g); setQueryParam("g1", g === "theme" ? null : g); };
  const setG2 = (g: string) => { setG2State(g); setQueryParam("g2", g === "home_project" ? null : g); };
  const openPeek = useCallback((id: string | null) => { setPeekState(id); setQueryParam("item", id ? controller.row(id)?.item_code ?? null : null); }, [controller]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const { bars, unscheduled } = useMemo(() => classifyRows(rows), [rows]);
  const barOf = useMemo(() => new Map(bars.map((b) => [b.id, b])), [bars]);
  const rowOf = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  // ---- the window: stable while you work (it only grows to hold bars), extended with the buttons
  const need = useMemo(() => defaultWindow(bars, today), [bars, today]);
  const [floor] = useState(need);
  const [pad, setPad] = useState({ before: 0, after: 0 });
  const win = useMemo(
    () => clampWindow({ startDay: Math.min(floor.startDay, need.startDay) - pad.before * 92, endDay: Math.max(floor.endDay, need.endDay) + pad.after * 92 }, 270),
    [floor, need, pad],
  );
  const width = (win.endDay - win.startDay) * PX_PER_DAY[zoom];

  const label = useCallback((field: string, v: unknown) => {
    if (field === "home_project") return lookups.projects.find((p) => p.id === v)?.name ?? String(v);
    return String(v);
  }, [lookups.projects]);
  const teamNames = useMemo(() => (lookups.teams ?? []).map((t) => t.name), [lookups.teams]);
  const teamsOf = useCallback((r: GanttRow) => {
    const text = typeof r.contributing_teams === "string" ? r.contributing_teams : "";
    return teamNames.filter((n) => text.split(/,\s*/).includes(n));
  }, [teamNames]);
  const lines = useMemo(
    () => layoutLines(rows, bars, { g1: g1 || null, g2: g1 && g2 && g2 !== g1 ? g2 : null, collapsed, label, teamsOf }),
    [rows, bars, g1, g2, collapsed, label, teamsOf],
  );

  // ---- windowed rows
  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 700 });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const read = () => setView({ top: el.scrollTop, height: el.clientHeight });
    read();
    let raf = 0;
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(read); };
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", onScroll); ro.disconnect(); cancelAnimationFrame(raf); };
  }, []);
  const first = Math.max(0, Math.floor(view.top / LINE_H) - BUFFER);
  const last = Math.min(lines.length, Math.ceil((view.top + view.height) / LINE_H) + BUFFER);

  // ---- changing dates: drag, keys, drop
  const [drag, setDrag] = useState<Drag | null>(null);
  const [staged, setStaged] = useState<{ id: string; range: Range } | null>(null);
  const [announce, setAnnounce] = useState("");
  const blockedReason = (field: "planned_start" | "g2m_date_est") => readOnlyReason(field);
  const lockReason = !canEdit ? "You have view-only access, so bars cannot be moved." : blockedReason("planned_start") ?? blockedReason("g2m_date_est");
  const commit = useCallback((id: string, base: Range, next: Range) => {
    if (next.startDay === base.startDay && next.endDay === base.endDay) return;
    const r = controller.setDates(id, { planned_start: fromDay(next.startDay), g2m_date_est: fromDay(next.endDay) });
    const code = controller.row(id)?.item_code ?? "";
    setAnnounce(r.ok ? `${code}: ${summarizeChange(base, next, today)}. Saved. Undo with Ctrl+Z.` : `${code}: ${r.error}`);
  }, [controller, today]);

  const startDrag = (e: React.PointerEvent, bar: Bar, mode: DragMode) => {
    if (e.button !== 0) return;
    if (lockReason) { controller.notify(lockReason); return; }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.stopPropagation();
    setStaged(null);
    setDrag({ id: bar.id, mode, originX: e.clientX, base: { startDay: bar.startDay, endDay: bar.endDay }, current: { startDay: bar.startDay, endDay: bar.endDay }, moved: false });
  };
  const moveDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    const days = Math.round((e.clientX - drag.originX) / PX_PER_DAY[zoom]);
    const current = drag.mode === "move" ? moveRange(drag.base, days, win) : resizeRange(drag.base, drag.mode, days, win);
    if (current.startDay !== drag.current.startDay || current.endDay !== drag.current.endDay || Math.abs(e.clientX - drag.originX) > 3) setDrag({ ...drag, current, moved: drag.moved || Math.abs(e.clientX - drag.originX) > 3 });
  };
  const endDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (drag.moved) commit(drag.id, drag.base, drag.current);
    else openPeek(drag.id); // a click, not a drag
    setDrag(null);
  };
  useEffect(() => {
    if (!drag) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setDrag(null); setAnnounce("Move cancelled."); } };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [drag]);

  const onBarKey = (e: React.KeyboardEvent, bar: Bar) => {
    const cur = staged?.id === bar.id ? staged.range : { startDay: bar.startDay, endDay: bar.endDay };
    if (e.key === "Escape" && staged) { e.preventDefault(); e.stopPropagation(); setStaged(null); setAnnounce("Change cancelled."); return; }
    if (e.key === "Enter" && staged?.id === bar.id) {
      e.preventDefault();
      commit(bar.id, { startDay: bar.startDay, endDay: bar.endDay }, staged.range);
      setStaged(null);
      return;
    }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPeek(bar.id); return; }
    const next = applyKey(cur, { key: e.key, shift: e.shiftKey, alt: e.altKey }, win);
    if (!next) return;
    e.preventDefault();
    if (lockReason) { controller.notify(lockReason); return; }
    setStaged({ id: bar.id, range: next });
    setAnnounce(`${controller.row(bar.id)?.item_code}: ${summarizeChange({ startDay: bar.startDay, endDay: bar.endDay }, next, today)}. Enter saves, Escape cancels.`);
  };

  const dayAtClientX = (clientX: number) => {
    const rect = scrollRef.current!.getBoundingClientRect();
    return xToDay(clientX - rect.left + scrollRef.current!.scrollLeft - LABEL_W, win, zoom);
  };
  const schedule = (id: string, day: number) => {
    const row = rowOf.get(id) ?? controller.row(id);
    if (!row) return;
    const r = scheduleAt(day, null, win);
    const res = controller.setDates(id, { planned_start: fromDay(r.startDay), g2m_date_est: fromDay(r.endDay) });
    setAnnounce(res.ok ? `${row.item_code} scheduled: Planned Start ${formatDate(fromDay(r.startDay), today)}, G2M Date (est) ${formatDate(fromDay(r.endDay), today)}. Undo with Ctrl+Z.` : `${row.item_code}: ${res.error}`);
  };

  // Ctrl/Cmd+Z undoes the last change (a bar move is one step), Shift+Z or Y redoes it; not while typing
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

  // Esc closes the item panel
  useEffect(() => {
    if (!peekId) return;
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "Escape" || drag || staged) return;
      if (t.closest("input, textarea, select, [role=dialog], [role=menu]")) return;
      openPeek(null);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [peekId, openPeek, drag, staged]);

  // ---- drawing
  const ticks = useMemo(() => timelineTicks(win, zoom), [win, zoom]);
  const years = useMemo(() => yearSpans(win, zoom), [win, zoom]);
  const todayX = dayToX(Math.round(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) / 86_400_000), win, zoom);
  const rangeOf = (bar: Bar): Range => (drag?.id === bar.id ? drag.current : staged?.id === bar.id ? staged.range : bar);
  const changeText = (bar: Bar) => (drag?.id === bar.id && drag.moved) || staged?.id === bar.id ? summarizeChange(bar, rangeOf(bar), today) : null;

  const renderLine = (l: Line, i: number) => {
    const top = HEAD_H + i * LINE_H;
    if (l.kind === "group") {
      return (
        <div key={l.id} className={`gl gl-group gl-g${l.level}`} style={{ top, height: LINE_H, width: LABEL_W + width }}>
          <div className="gl-label" style={{ width: LABEL_W, paddingLeft: 8 + (l.level - 1) * 14 }}>
            <button type="button" className="gl-toggle" aria-expanded={!l.collapsed} aria-label={`${l.collapsed ? "Expand" : "Collapse"} ${l.label}`}
              onClick={() => setCollapsed((c) => { const n = new Set(c); if (!n.delete(l.id)) n.add(l.id); return n; })}>{l.collapsed ? "▸" : "▾"}</button>
            <span className="gl-name">{l.label}</span>
            <span className="gl-count">{l.count}</span>
          </div>
          {l.span && <div className="gl-span" aria-hidden="true" style={{ left: LABEL_W + dayToX(l.span.startDay, win, zoom), width: Math.max(2, (l.span.endDay - l.span.startDay) * PX_PER_DAY[zoom]) }} />}
        </div>
      );
    }
    const bar = barOf.get(l.itemId);
    const row = rowOf.get(l.itemId) as GridItem | undefined;
    if (!bar || !row) return null;
    const r = rangeOf(bar);
    const left = LABEL_W + dayToX(r.startDay, win, zoom);
    const w = Math.max(6, (r.endDay - r.startDay + 1) * PX_PER_DAY[zoom]);
    const health = row.health ? String(row.health) : "";
    const progress = typeof row.delivery_progress_pct === "number" ? Math.max(0, Math.min(100, row.delivery_progress_pct)) : null;
    const tip = changeText(bar);
    const aria = `${row.item_code} ${row.initiative_name}, ${formatDate(fromDay(r.startDay), today)} to ${formatDate(fromDay(r.endDay), today)}${health ? `, health ${health}` : ""}. ${lockReason ? "" : "Arrow keys move it, Alt and arrows change the end date, Alt and Shift and arrows the start date, Enter saves."}`;
    return (
      <div key={l.id} className="gl gl-item" style={{ top, height: LINE_H, width: LABEL_W + width }} data-item={row.id}>
        <div className="gl-label" style={{ width: LABEL_W, paddingLeft: 8 + Math.max(0, l.level - 1) * 14 + 18 }}>
          <button type="button" className="gl-open" onClick={() => openPeek(row.id)} title={`${row.item_code} ${row.initiative_name}`}>
            <span className="mono muted">{row.item_code}</span> <span className="gl-name">{row.initiative_name}</span>
          </button>
          {health && <span className={`pill health-${slug(health)} gl-health`}>{health}</span>}
        </div>
        <div
          className={`gbar health-bar-${slug(health || "none")}${lockReason ? " gbar-locked" : ""}${tip ? " gbar-staged" : ""}`}
          style={{ left, width: w }} role="button" tabIndex={0} aria-label={aria} data-bar={row.id}
          onPointerDown={(e) => startDrag(e, bar, "move")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => setDrag(null)}
          onKeyDown={(e) => onBarKey(e, bar)} onBlur={() => { if (staged?.id === bar.id) { setStaged(null); setAnnounce("Change cancelled."); } }}
        >
          {progress !== null && <span className="gbar-fill" style={{ width: `${progress}%` }} />}
          <span className="gbar-text">{w > 90 ? `${row.item_code} ${row.initiative_name}` : ""}</span>
          {w <= 90 && <span className="gbar-out" aria-hidden="true">{row.item_code} {row.initiative_name}</span>}
          {!lockReason && <span className="gbar-h gbar-h-start" onPointerDown={(e) => startDrag(e, bar, "start")} onPointerMove={moveDrag} onPointerUp={endDrag} aria-hidden="true" />}
          {!lockReason && <span className="gbar-h gbar-h-end" onPointerDown={(e) => startDrag(e, bar, "end")} onPointerMove={moveDrag} onPointerUp={endDrag} aria-hidden="true" />}
          {tip && <span className="gbar-tip" role="status">{tip}</span>}
        </div>
      </div>
    );
  };

  const groupsUsed = [g1, g2].filter(Boolean);
  return (
    <div className="gantt-page">
      <div className="gantt-toolbar page-head">
        <h1>Gantt</h1>
        <p className="muted gantt-count">
          {bars.length} scheduled · {unscheduled.length} unscheduled{scope.selection.kind !== "all" ? ` · scope: ${scope.label}` : ""}{filterName ? ` · filters of “${filterName}”` : ""}
        </p>
        <div className="gantt-tools">
          <label>Group by <select value={g1} onChange={(e) => setG1(e.target.value)}>{groupOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
          <label>then <select value={g2} disabled={!g1} onChange={(e) => setG2(e.target.value)}>{groupOptions.filter((o) => o.key !== g1).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
          <label>Filters of <select value={views.some((v) => v.id === viewParam) ? viewParam! : ""} onChange={(e) => setQueryParam("view", e.target.value || null)}>
            <option value="">No saved view</option>{views.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select></label>
          <div role="group" aria-label="Zoom" className="gantt-zoom">
            {(["month", "quarter"] as const).map((z) => <button key={z} type="button" className={zoom === z ? "view-chip view-chip-on" : "view-chip"} aria-pressed={zoom === z} onClick={() => setZoom(z)}>{z === "month" ? "Month" : "Quarter"}</button>)}
          </div>
          <button type="button" className="tool-btn" onClick={() => scrollRef.current?.scrollTo({ left: Math.max(0, LABEL_W + todayX - 400), behavior: "smooth" })}>Today</button>
        </div>
      </div>

      <div className={peekId ? "gantt-split gantt-split-open" : "gantt-split"}>
        <div className="gantt-chart">
          <StatusStrip controller={controller} />
          <div ref={scrollRef} className="gantt-scroll" data-testid="gantt-scroll" tabIndex={-1}>
            <div className="gantt-inner" style={{ width: LABEL_W + width, height: HEAD_H + lines.length * LINE_H + 8 }}
              onDragOver={(e) => { if (canEdit && !lockReason) e.preventDefault(); }}
              onDrop={(e) => { const id = e.dataTransfer.getData("text/plain"); if (!id || lockReason) return; e.preventDefault(); schedule(id, dayAtClientX(e.clientX)); }}>
              <div className="gantt-head" style={{ width: LABEL_W + width, height: HEAD_H }}>
                <div className="gl-corner" style={{ width: LABEL_W }}>Initiative</div>
                {years.map((y) => <div key={y.label} className="gh-year" style={{ left: LABEL_W + y.x, width: y.width }}>{y.label}</div>)}
                {ticks.map((t) => <div key={t.startDay} className="gh-tick" style={{ left: LABEL_W + t.x, width: t.width }}>{t.label}</div>)}
              </div>
              <div className="gantt-grid" aria-hidden="true" style={{ left: LABEL_W, top: HEAD_H, width, height: lines.length * LINE_H + 8 }}>
                {ticks.map((t) => <div key={t.startDay} className="gg-line" style={{ left: t.x }} />)}
              </div>
              <div className="gantt-today" aria-hidden="true" style={{ left: LABEL_W + todayX, top: HEAD_H }} title={`Today, ${formatDate(fromDay(Math.round(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) / 86_400_000)), today)}`}><span>Today</span></div>
              {lines.slice(first, last).map((l, k) => renderLine(l, first + k))}
              {lines.length === 0 && <p className="gantt-empty muted">{rows.length === 0 ? "No initiatives in this scope." : "Nothing is scheduled yet. Drag an item from Unscheduled onto the timeline."}</p>}
            </div>
          </div>
          <div className="gantt-foot">
            <button type="button" className="link-button" onClick={() => setPad((p) => ({ ...p, before: p.before + 1 }))}>Show earlier months</button>
            <button type="button" className="link-button" onClick={() => setPad((p) => ({ ...p, after: p.after + 1 }))}>Show later months</button>
            <span className="muted">
              {groupsUsed.length === 0 ? "Not grouped" : `Grouped by ${groupsUsed.map((g) => groupOptions.find((o) => o.key === g)?.label).join(", then ")}`} · bars run from Planned Start to G2M Date (est), the fill is GitHub delivery progress · drag a bar to move it, drag an edge to change a date · keys: ←→ move, Alt+←→ end date, Alt+Shift+←→ start date, Enter saves, Esc cancels
            </span>
            {lockReason && <span role="note" className="muted"> · {lockReason}</span>}
          </div>
          <div className="visually-hidden" role="status" aria-live="polite">{announce}</div>

          <section className="gantt-unscheduled" aria-label="Unscheduled">
            <h2>Unscheduled <span className="gl-count">{unscheduled.length}</span></h2>
            {unscheduled.length === 0 ? <p className="muted">Every initiative in this view has dates.</p> : (
              <>
                <p className="muted">Drag an item onto the timeline to set Planned Start and G2M Date (est), or use the button to start today.</p>
                <ul>
                  {unscheduled.map((u) => {
                    const row = rowOf.get(u.id)!;
                    return (
                      <li key={u.id} draggable={canEdit && !lockReason} onDragStart={(e) => { e.dataTransfer.setData("text/plain", u.id); e.dataTransfer.effectAllowed = "move"; }} data-unscheduled={u.id}>
                        <button type="button" className="gl-open" onClick={() => openPeek(u.id)}><span className="mono muted">{row.item_code}</span> {row.initiative_name}</button>
                        <span className="muted"> · {u.reason}</span>
                        {canEdit && !lockReason && <button type="button" className="btn" onClick={() => schedule(u.id, Math.round(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) / 86_400_000))} aria-label={`Schedule ${row.item_code} from today`}>Schedule from today</button>}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
        </div>
        {peekId && <ItemPanel controller={controller} lookups={lookups} itemId={peekId} me={me} mode="peek" onClose={() => openPeek(null)} pageHref={pageHref} />}
      </div>
    </div>
  );
}
