"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import {
  GANTT_DEFAULT_VIEWS, GANTT_FALLBACK, GANTT_VIEW_NAMES, PX_PER_DAY, ZOOMS, ZOOM_LABEL, allGroupIds, applyKey, buildDeps, chainOf, classifyRows, clampWindow, dayToX, daysText, defaultWindow, fitZoom, formatDate, fromDay, ganttGroupOptions, gateMarker, isZoom,
  layoutLines, matchesFilters, matchesSearch, moveMany, sanitizeGanttSettings, sanitizeView, moveRange, planVsActual, readOnlyReason, resizeRange, rollup, scheduleAt, summarizeChange, timelineTicks, xToDay, yearSpans,
  type Bar, type Filter, type GanttRow, type GanttSettings, type Line, type PlanStatus, type Range, type Zoom,
} from "@pv/domain";
import type { PortfolioController } from "../portfolio/controller";
import { ItemPanel } from "../portfolio/item-panel";
import { ChoiceMenu } from "../portfolio/choice-menu";
import { FilterPanel } from "../portfolio/filter-panel";
import { StatusStrip, useStatus } from "../portfolio/status-strip";
import { baseDef, baseParam, parseBase, sameView, type BaseView } from "../portfolio/grid-view";
import { summarize } from "../portfolio/view-controls";
import { useViews, ViewBar } from "../portfolio/view-bar";
import { useWorkspace } from "../workspace/provider";
import type { GridItem, Lookups } from "../portfolio/types";
import { setQueryParam, useScope } from "../workspace/scope";
import { StatusPill } from "../../components/status-pill";
import { downloadPng, printPicture, renderGantt, type ExportLine } from "./gantt-export";
import { PageHeader } from "@/components/page-header";
import { personName } from "../portfolio/people";

const LABEL_DEFAULT = 320, LABEL_MIN = 220, LABEL_MAX = 560;
const HEAD_H = 62;
const BUFFER = 8;
const PRIORITISATION: BaseView = { kind: "builtin", name: "Prioritisation" };
const GANTT_VIEW_STORAGE_KEY = "pv:gantt-view";
function readStoredView(): string | null { try { return window.sessionStorage.getItem(GANTT_VIEW_STORAGE_KEY); } catch { return null; } }
function writeStoredView(param: string | null) {
  try { if (param === null) window.sessionStorage.removeItem(GANTT_VIEW_STORAGE_KEY); else window.sessionStorage.setItem(GANTT_VIEW_STORAGE_KEY, param); } catch { /* no storage: the view lasts until reload only */ }
}
const DENSITY = { compact: { line: 28, bar: 18, top: 3 }, comfortable: { line: 44, bar: 22, top: 8 } } as const;
const MAX_EDGES = 800;

/** A per-person display preference kept in the browser; never needed to render, so every access is guarded. */
const storeListeners = new Set<() => void>();
function readStored(key: string): string | null { try { return window.localStorage.getItem(key); } catch { return null; } }
function useStored<T extends string | number>(key: string, initial: T, valid: (v: unknown) => v is T): [T, (v: T) => void] {
  const raw = useSyncExternalStore(
    (cb) => { storeListeners.add(cb); return () => { storeListeners.delete(cb); }; },
    () => readStored(key),
    () => null,
  );
  const parsed = raw === null ? initial : typeof initial === "number" ? Number(raw) : raw;
  const value = valid(parsed) ? parsed : initial;
  return [value, (v: T) => { try { window.localStorage.setItem(key, String(v)); } catch { /* no storage: the choice lasts until reload only */ } storeListeners.forEach((l) => l()); }];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, "-");
const dayNumber = (d: Date) => Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000);
type DragMode = "move" | "start" | "end";
type Drag = { id: string; mode: DragMode; originX: number; base: Range; current: Range; moved: boolean; group: string[] | null };
type Staged = { id: string; range: Range; group: string[] | null };
type Hover = { id: string; x: number; y: number };

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
  const status = useStatus(controller);
  const scope = useScope();
  const { views, defaults, ready } = useWorkspace("gantt");
  const optionKeys = useMemo(() => ganttGroupOptions().map((o) => o.key), []);

  // ---- the view: 3 default Gantt views + saved views, kept in the address (?view=) and session storage; what you change stays until you save or reset
  type Shared = { filters?: Filter[]; gantt?: Partial<GanttSettings> };
  const [base, setBase] = useState<BaseView>(() => parseBase(params.get("view") ?? readStoredView(), PRIORITISATION));
  const [shared, setShared] = useState<Shared>(() => {
    // the address carries what you changed (zoom, the two groups, row height) so a reload or a shared link keeps it
    const g: Partial<GanttSettings> = {};
    const z = params.get("zoom"); if (isZoom(z)) g.zoom = z;
    const g1 = params.get("g1"); if (g1 !== null && optionKeys.includes(g1)) g.g1 = g1;
    const g2 = params.get("g2"); if (g2 !== null && optionKeys.includes(g2)) g.g2 = g2;
    const d = params.get("density"); if (d === "compact" || d === "comfortable") g.density = d;
    return Object.keys(g).length > 0 ? { gantt: g } : {};
  });
  const [search, setSearch] = useState("");
  const savedDef = useMemo(() => baseDef(base, views, defaults, GANTT_DEFAULT_VIEWS), [base, views, defaults]);
  const baseMissing = base.kind === "saved" && savedDef === null && ready;
  const [storedDensity, setStoredDensity] = useStored<"compact" | "comfortable">("pv.gantt.density", GANTT_FALLBACK.density, (v): v is "compact" | "comfortable" => v === "compact" || v === "comfortable");
  const bDef = useMemo(() => {
    const d = savedDef ?? baseDef(PRIORITISATION, [], defaults, GANTT_DEFAULT_VIEWS)!;
    // a view saved on another page has no Gantt settings: the Gantt's own defaults apply (and the row height this person last chose)
    return sanitizeView({ ...d, gantt: d.gantt ?? { ...GANTT_FALLBACK, density: storedDensity } });
  }, [savedDef, defaults, storedDensity]);
  const settings: GanttSettings = useMemo(() => ({ ...bDef.gantt!, ...shared.gantt }), [bDef, shared.gantt]);
  const filters = shared.filters ?? bDef.filters;
  const def = useMemo(() => sanitizeView({ ...bDef, filters, gantt: sanitizeGanttSettings(settings) }), [bDef, filters, settings]);
  const dirty = !sameView(def, bDef);
  useEffect(() => {
    const p = baseParam(base);
    writeStoredView(p);
    if (params.get("view") === null && p !== null) setQueryParam("view", p);
  }, [base, params]);
  const clearAddress = () => { setQueryParam("zoom", null); setQueryParam("g1", null); setQueryParam("g2", null); setQueryParam("density", null); };
  const openBase = (b: BaseView) => {
    setShared({}); setBase(b); clearAddress();
    const p = baseParam(b);
    setQueryParam("view", p); writeStoredView(p);
  };
  const resetChanges = () => { setShared({}); clearAddress(); };
  const viewsApi = useViews({ surface: "gantt", base, def, bDef, dirty, openBase, discard: resetChanges, reset: resetChanges, builtins: GANTT_VIEW_NAMES, defaultBar: GANTT_VIEW_NAMES, builtinDefs: GANTT_DEFAULT_VIEWS });
  const filterName = base.kind === "saved" ? (views.find((v) => v.id === base.id)?.name ?? null) : null;
  const setFilters = (f: Filter[]) => setShared((p) => ({ ...p, filters: f }));
  const changeGantt = (patch: Partial<GanttSettings>) => setShared((p) => ({ ...p, gantt: { ...p.gantt, ...patch } }));

  const rows = useMemo<GridItem[]>(
    () => controller.rows.filter((r) => (scope.projectIds === null || scope.projectIds.includes(r.home_project)) && matchesSearch(r, search, (id) => personName(lookups, id, "")) && matchesFilters(r, filters, { me: controller.mePerson(me), today: controller.todayDate() })),
    // the controller changes its rows in place; the version says when
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, status.version, scope.projectIds, search, filters, me, lookups.members, lookups.people],
  );
  const todayN = dayNumber(controller.todayDate());
  const today = useMemo(() => new Date(todayN * 86_400_000), [todayN]);
  const canEdit = controller.canEdit;
  const groupOptions = useMemo(() => ganttGroupOptions(), []);

  // ---- display settings: they come from the open view, and what you change stays in the address until you save or reset
  const zoom = settings.zoom, g1 = settings.g1, g2 = settings.g2, density = settings.density;
  const [peekId, setPeekState] = useState<string | null>(() => { const c = params.get("item"); return c ? controller.rows.find((r) => r.item_code === c)?.id ?? null : null; });
  const [labelW, setLabelW] = useStored<number>("pv.gantt.labelw", LABEL_DEFAULT, (v): v is number => typeof v === "number" && v >= LABEL_MIN && v <= LABEL_MAX);
  const D = DENSITY[density];
  const LINE_H = D.line;
  const setG1 = (g: string) => { changeGantt({ g1: g }); setQueryParam("g1", g === bDef.gantt!.g1 ? null : g); };
  const setG2 = (g: string) => { changeGantt({ g2: g }); setQueryParam("g2", g === bDef.gantt!.g2 ? null : g); };
  const setDensity = (d: "compact" | "comfortable") => { changeGantt({ density: d }); setQueryParam("density", d === bDef.gantt!.density ? null : d); setStoredDensity(d); };
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
  const layoutOpts = useMemo(() => ({ g1: g1 || null, g2: g1 && g2 && g2 !== g1 ? g2 : null, label, teamsOf }), [g1, g2, label, teamsOf]);
  const lines = useMemo(() => layoutLines(rows, bars, { ...layoutOpts, collapsed }), [rows, bars, layoutOpts, collapsed]);
  const groupIds = useMemo(() => allGroupIds(rows, bars, layoutOpts), [rows, bars, layoutOpts]);

  // ---- what each bar knows besides its dates: plan against actual, gates, dependencies
  const plans = useMemo(() => { const m = new Map<string, PlanStatus>(); for (const r of rows) { const b = barOf.get(r.id); if (b) m.set(r.id, planVsActual(r, b, today)); } return m; }, [rows, barOf, today]);
  const deps = useMemo(() => buildDeps(rows, bars), [rows, bars]);
  const lineIndex = useMemo(() => { const m = new Map<string, number>(); lines.forEach((l, i) => { if (l.kind === "item" && !m.has(l.itemId)) m.set(l.itemId, i); }); return m; }, [lines]);

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

  // ---- hover and focus: the card, and the chain of dependencies behind a bar
  const [hover, setHover] = useState<Hover | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const chain = useMemo(() => { if (!focusId) return null; const c = chainOf(deps.edges, focusId); return c.edges.size > 0 ? c : null; }, [focusId, deps.edges]);

  // ---- selection (several bars move together)
  const [picked, setSel] = useState<ReadonlySet<string>>(new Set());
  const sel = useMemo(() => new Set([...picked].filter((id) => barOf.has(id))), [picked, barOf]); // a bar that left the view is no longer selected
  const toggleSel = (id: string) => setSel((c) => { const n = new Set(c); if (!n.delete(id)) n.add(id); return n; });

  // ---- changing dates: drag, keys, drop
  const [drag, setDrag] = useState<Drag | null>(null);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [announce, setAnnounce] = useState("");
  const blockedReason = (field: "planned_start" | "g2m_date_est") => readOnlyReason(field);
  const lockReason = !canEdit ? "You have view-only access, so bars cannot be moved." : blockedReason("planned_start") ?? blockedReason("g2m_date_est");
  const commit = useCallback((id: string, base: Range, next: Range) => {
    if (next.startDay === base.startDay && next.endDay === base.endDay) return;
    const r = controller.setDates(id, { planned_start: fromDay(next.startDay), g2m_date_est: fromDay(next.endDay) });
    const code = controller.row(id)?.item_code ?? "";
    setAnnounce(r.ok ? `${code}: ${summarizeChange(base, next, today)}. Saved. Undo with Ctrl+Z.` : `${code}: ${r.error}`);
  }, [controller, today]);
  const commitGroup = useCallback((ids: string[], delta: number) => {
    if (delta === 0) return;
    const changes = ids.flatMap((id) => { const b = barOf.get(id); return b ? [{ id, planned_start: fromDay(b.startDay + delta), g2m_date_est: fromDay(b.endDay + delta) }] : []; });
    const r = controller.setManyDates(changes);
    setAnnounce(r.ok ? `${changes.length} items moved by ${daysText(Math.abs(delta))} ${delta > 0 ? "later" : "earlier"}. Saved as one change. Undo with Ctrl+Z.` : r.error);
  }, [controller, barOf]);
  const groupDelta = useCallback((ids: string[], delta: number) => moveMany(ids.flatMap((id) => { const b = barOf.get(id); return b ? [b] : []; }), delta, win), [barOf, win]);

  const startDrag = (e: React.PointerEvent, bar: Bar, mode: DragMode) => {
    if (e.button !== 0) return;
    if (mode === "move" && (e.shiftKey || e.metaKey || e.ctrlKey)) { e.preventDefault(); toggleSel(bar.id); return; }
    if (lockReason) { controller.notify(lockReason); return; }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.stopPropagation();
    setStaged(null); setHover(null);
    const group = mode === "move" && sel.has(bar.id) && sel.size > 1 ? [...sel] : null;
    setDrag({ id: bar.id, mode, originX: e.clientX, base: { startDay: bar.startDay, endDay: bar.endDay }, current: { startDay: bar.startDay, endDay: bar.endDay }, moved: false, group });
  };
  const moveDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    const raw = Math.round((e.clientX - drag.originX) / PX_PER_DAY[zoom]);
    const current = drag.group ? (() => { const d = groupDelta(drag.group, raw); return { startDay: drag.base.startDay + d, endDay: drag.base.endDay + d }; })()
      : drag.mode === "move" ? moveRange(drag.base, raw, win) : resizeRange(drag.base, drag.mode, raw, win);
    if (current.startDay !== drag.current.startDay || current.endDay !== drag.current.endDay || Math.abs(e.clientX - drag.originX) > 3) setDrag({ ...drag, current, moved: drag.moved || Math.abs(e.clientX - drag.originX) > 3 });
  };
  const endDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (drag.moved) { if (drag.group) commitGroup(drag.group, drag.current.startDay - drag.base.startDay); else commit(drag.id, drag.base, drag.current); }
    else { setSel(new Set()); openPeek(drag.id); } // a click, not a drag
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
      if (staged.group) commitGroup(staged.group, staged.range.startDay - bar.startDay);
      else commit(bar.id, { startDay: bar.startDay, endDay: bar.endDay }, staged.range);
      setStaged(null);
      return;
    }
    if ((e.key === "s" || e.key === "S") && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); toggleSel(bar.id); setAnnounce(`${controller.row(bar.id)?.item_code} ${sel.has(bar.id) ? "removed from" : "added to"} the selection.`); return; }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPeek(bar.id); return; }
    const group = sel.has(bar.id) && sel.size > 1 && !e.altKey ? [...sel] : null;
    const next = applyKey(cur, { key: e.key, shift: e.shiftKey, alt: e.altKey }, win);
    if (!next) return;
    e.preventDefault();
    if (lockReason) { controller.notify(lockReason); return; }
    if (group) {
      const d = groupDelta(group, next.startDay - bar.startDay);
      const range = { startDay: bar.startDay + d, endDay: bar.endDay + d };
      setStaged({ id: bar.id, range, group });
      setAnnounce(`${group.length} selected items would move ${daysText(Math.abs(d))} ${d >= 0 ? "later" : "earlier"}. Enter saves, Escape cancels.`);
      return;
    }
    setStaged({ id: bar.id, range: next, group: null });
    setAnnounce(`${controller.row(bar.id)?.item_code}: ${summarizeChange({ startDay: bar.startDay, endDay: bar.endDay }, next, today)}. Enter saves, Escape cancels.`);
  };

  const dayAtClientX = (clientX: number) => {
    const rect = scrollRef.current!.getBoundingClientRect();
    return xToDay(clientX - rect.left + scrollRef.current!.scrollLeft - labelW, win, zoom);
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

  // Esc clears the selection, then closes the item panel
  useEffect(() => {
    if (!peekId && sel.size === 0) return;
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "Escape" || drag || staged) return;
      if (t.closest("input, textarea, select, [role=dialog], [role=menu]")) return;
      if (sel.size > 0) { setSel(new Set()); return; }
      openPeek(null);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [peekId, openPeek, drag, staged, sel]);

  // ---- zoom: buttons, Fit, and Ctrl/Cmd + wheel; the day in the middle of the screen stays in the middle
  const touched = useRef(false);
  const anchor = useRef<number | null>(null);
  const setZoom = (z: Zoom, fit = false) => {
    const el = scrollRef.current;
    if (el && !fit) anchor.current = win.startDay + (el.scrollLeft + (labelW + el.clientWidth) / 2 - labelW) / PX_PER_DAY[zoom];
    else anchor.current = fit ? -1 : null;
    touched.current = true;
    changeGantt({ zoom: z });
    setQueryParam("zoom", z === bDef.gantt!.zoom ? null : z);
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || anchor.current === null) return;
    el.scrollLeft = anchor.current === -1 ? 0 : Math.max(0, labelW + (anchor.current - win.startDay) * PX_PER_DAY[zoom] - (labelW + el.clientWidth) / 2);
    anchor.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);
  const fit = () => { const el = scrollRef.current; if (el) setZoom(fitZoom(win, el.clientWidth - labelW - 2), true); };
  const step = useRef<(dir: -1 | 1) => void>(() => {});
  useEffect(() => { step.current = (dir) => { const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, ZOOMS.indexOf(zoom) + dir))]!; if (next !== zoom) setZoom(next); }; });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let at = 0;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      if (Date.now() - at < 220) return;
      at = Date.now();
      step.current(e.deltaY < 0 ? -1 : 1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ---- drawing
  const ticks = useMemo(() => timelineTicks(win, zoom), [win, zoom]);
  const years = useMemo(() => yearSpans(win, zoom), [win, zoom]);
  const todayX = dayToX(todayN, win, zoom);
  // Open on today (not at the window's left edge): once on mount, and again if the window's start moves before the person has scrolled.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onUser = () => { touched.current = true; };
    el.addEventListener("wheel", onUser, { passive: true });
    el.addEventListener("pointerdown", onUser, { passive: true });
    el.addEventListener("keydown", onUser);
    return () => { el.removeEventListener("wheel", onUser); el.removeEventListener("pointerdown", onUser); el.removeEventListener("keydown", onUser); };
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || touched.current) return;
    el.scrollLeft = Math.max(0, labelW + todayX - 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayX]);
  const live = (bar: Bar): Range => {
    const src = drag?.moved ? { id: drag.id, base: drag.base, cur: drag.current, group: drag.group } : staged ? { id: staged.id, base: barOf.get(staged.id) ?? bar, cur: staged.range, group: staged.group } : null;
    if (!src) return bar;
    if (bar.id === src.id) return src.cur;
    if (src.group?.includes(bar.id)) { const d = src.cur.startDay - src.base.startDay; return { startDay: bar.startDay + d, endDay: bar.endDay + d }; }
    return bar;
  };
  const changeText = (bar: Bar) => {
    const moving = (drag?.moved && (drag.id === bar.id)) || staged?.id === bar.id;
    if (!moving) return null;
    const group = (drag?.moved ? drag.group : staged?.group) ?? null;
    if (group) { const d = live(bar).startDay - bar.startDay; return `${group.length} items ${d === 0 ? "not moved" : `${daysText(Math.abs(d))} ${d > 0 ? "later" : "earlier"}`}`; }
    return summarizeChange(bar, live(bar), today);
  };
  const memberName = (id: unknown) => { const e = personName(lookups, id, ""); return e ? e.split("@")[0]! : ""; };

  const showCard = (row: GridItem, el: HTMLElement, at?: { x: number }) => {
    const r = el.getBoundingClientRect();
    setHover({ id: row.id, x: at?.x ?? r.left, y: r.bottom + 6 });
  };

  const renderLine = (l: Line, i: number) => {
    const top = HEAD_H + i * LINE_H;
    if (l.kind === "group") {
      const members = l.members.map((id) => rowOf.get(id)).filter((r): r is GridItem => !!r);
      const roll = rollup(members, barOf, today);
      return (
        <div key={l.id} className={`gl gl-group gl-g${l.level}`} style={{ top, height: LINE_H, width: labelW + width }}>
          <div className="gl-label" style={{ width: labelW, paddingLeft: 8 + (l.level - 1) * 14 }}>
            <button type="button" className="gl-toggle" aria-expanded={!l.collapsed} aria-label={`${l.collapsed ? "Expand" : "Collapse"} ${l.label}`}
              onClick={() => setCollapsed((c) => { const n = new Set(c); if (!n.delete(l.id)) n.add(l.id); return n; })}>{l.collapsed ? "▸" : "▾"}</button>
            <span className="gl-name">{l.label}</span>
            <span className="gl-count">{l.count}</span>
            <span className="gl-roll" title={`${roll.text}${roll.progress !== null ? `; delivery progress ${roll.progress}%` : ""}`}>
              {roll.atRisk > 0 && <span className="gl-flag gl-flag-risk">{roll.atRisk} at risk</span>}
              {roll.late > 0 && <span className="gl-flag gl-flag-late">{roll.late} late</span>}
              {roll.blocked > 0 && <span className="gl-flag gl-flag-blocked">{roll.blocked} blocked</span>}
              {roll.progress !== null && <span className="gl-prog">{roll.progress}%</span>}
            </span>
          </div>
          {l.span && (
            <div className="gl-span" aria-hidden="true" style={{ left: labelW + dayToX(l.span.startDay, win, zoom), width: Math.max(2, (l.span.endDay - l.span.startDay) * PX_PER_DAY[zoom]), top: LINE_H / 2 - 4 }}>
              {roll.progress !== null && <span className="gl-span-fill" style={{ width: `${roll.progress}%` }} />}
            </div>
          )}
        </div>
      );
    }
    const bar = barOf.get(l.itemId);
    const row = rowOf.get(l.itemId) as GridItem | undefined;
    if (!bar || !row) return null;
    const r = live(bar);
    const px = PX_PER_DAY[zoom];
    const left = labelW + dayToX(r.startDay, win, zoom);
    const w = Math.max(6, (r.endDay - r.startDay + 1) * px);
    const health = row.health ? String(row.health) : "";
    const phase = row.initiative_phase ? String(row.initiative_phase) : "";
    const progress = typeof row.delivery_progress_pct === "number" ? Math.max(0, Math.min(100, row.delivery_progress_pct)) : null;
    const plan = plans.get(row.id);
    const gate = gateMarker(row);
    const dc = deps.counts.get(row.id);
    const tip = changeText(bar);
    const dim = chain !== null && !chain.ids.has(row.id);
    const text = w >= 120 ? `${row.item_code} ${row.initiative_name}` : w >= 44 ? String(row.item_code) : "";
    const note = plan?.overdue != null ? `Overdue ${plan.overdue} d` : plan?.endSlip != null && plan.endSlip > 0 ? `Finished ${plan.endSlip} d late` : null;
    const gateX = gate ? labelW + dayToX(gate.day, win, zoom) + px / 2 : null;
    const barEnd = left + w;
    const noteLeft = gateX !== null && gateX >= barEnd - 4 && gateX < barEnd + 90 ? gateX + 22 : barEnd + 8;
    const depText = dc ? `${dc.total} ${dc.total === 1 ? "dependency" : "dependencies"}${dc.clashes ? `, ${dc.clashes} starting too early` : ""}` : "";
    const aria = `${row.item_code} ${row.initiative_name}, ${formatDate(fromDay(r.startDay), today)} to ${formatDate(fromDay(r.endDay), today)}${health ? `, health ${health}` : ""}${phase ? `, phase ${phase}` : ""}${plan?.notes.length ? `. ${plan.notes.join(". ")}` : ""}${gate ? `. ${gate.text}` : ""}${depText ? `. ${depText}` : ""}. ${lockReason ? "" : "Arrow keys move it, Alt and arrows change the end date, Alt and Shift and arrows the start date, Enter saves, S selects it."}`;
    const classes = ["gbar", `health-bar-${slug(health || "none")}`, lockReason ? "gbar-locked" : "", tip ? "gbar-staged" : "", sel.has(row.id) ? "gbar-selected" : "", dim ? "gbar-dim" : "", plan?.overdue != null ? "gbar-late" : ""].filter(Boolean).join(" ");
    return (
      <div key={l.id} className={`gl gl-item${dim ? " gl-dim" : ""}`} style={{ top, height: LINE_H, width: labelW + width }} data-item={row.id}>
        <div className={`gl-label gl-label-${density}`} style={{ width: labelW, paddingLeft: 8 + Math.max(0, l.level - 1) * 14 + 18 }}>
          <button type="button" className="gl-open" onClick={() => openPeek(row.id)} title={`${row.item_code} ${row.initiative_name}`}>
            <span className="mono muted">{row.item_code}</span> <span className="gl-name">{row.initiative_name}</span>
          </button>
          <span className="gl-side">
            {health && <StatusPill value={health} className="gl-health" />}
            {(density === "comfortable" ? (phase || dc) : dc) && (
              <span className="gl-meta">
                {density === "comfortable" && phase}
                {dc && <span className={dc.clashes ? "gl-dep gl-dep-clash" : "gl-dep"} title={depText}>{density === "comfortable" && phase ? " · " : ""}{dc.total} {dc.total === 1 ? "dep" : "deps"}{dc.clashes ? `, ${dc.clashes} early` : ""}</span>}
              </span>
            )}
          </span>
        </div>
        <div
          className={classes}
          style={{ left, width: w, top: D.top, height: D.bar }} role="button" tabIndex={0} aria-label={aria} data-bar={row.id}
          onPointerDown={(e) => startDrag(e, bar, "move")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => setDrag(null)}
          onPointerEnter={(e) => { setFocusId(row.id); if (!drag) showCard(row, e.currentTarget, { x: e.clientX + 12 }); }}
          onPointerLeave={() => { setHover(null); setFocusId((f) => (f === row.id ? null : f)); }}
          onFocus={(e) => { setFocusId(row.id); showCard(row, e.currentTarget); }}
          onKeyDown={(e) => onBarKey(e, bar)}
          onBlur={() => { setHover(null); setFocusId((f) => (f === row.id ? null : f)); if (staged?.id === bar.id) { setStaged(null); setAnnounce("Change cancelled."); } }}
        >
          {progress !== null && <span className="gbar-fill" style={{ width: `${progress}%` }} />}
          {text && <span className="gbar-text" style={{ left: labelW + 6 }}>{text}</span>}
          {!lockReason && <span className="gbar-h gbar-h-start" onPointerDown={(e) => startDrag(e, bar, "start")} onPointerMove={moveDrag} onPointerUp={endDrag} aria-hidden="true" />}
          {!lockReason && <span className="gbar-h gbar-h-end" onPointerDown={(e) => startDrag(e, bar, "end")} onPointerMove={moveDrag} onPointerUp={endDrag} aria-hidden="true" />}
          {tip && <span className="gbar-tip" role="status" style={{ top: D.bar + 4 }}>{tip}</span>}
        </div>
        {plan?.actualLine && (
          <span className={`gactual${plan.actualLine.running ? " gactual-running" : ""}${(plan.endSlip ?? 0) > 0 || plan.overdue != null ? " gactual-late" : ""}`} aria-hidden="true"
            style={{ left: labelW + dayToX(plan.actualLine.startDay, win, zoom), width: Math.max(2, (plan.actualLine.endDay - plan.actualLine.startDay + 1) * px), top: D.top + D.bar + 2, height: density === "comfortable" ? 4 : 3 }} />
        )}
        {gate && gateX !== null && <span className="ggate" aria-hidden="true" style={{ left: gateX - 6, top: D.top + D.bar / 2 - 6 }}><span className="ggate-l">{gate.gate}</span></span>}
        {note && <span className="gnote" aria-hidden="true" style={{ left: noteLeft, top: D.top, height: D.bar }}>{note}</span>}
      </div>
    );
  };

  // dependency arrows between the rows in view (from `depends_on`; red when the item starts before what it waits for ends)
  const edgePaths = useMemo(() => {
    const out: { key: string; d: string; clash: boolean; active: boolean; dim: boolean }[] = [];
    for (const e of deps.edges) {
      const a = lineIndex.get(e.from), b = lineIndex.get(e.to);
      const pa = barOf.get(e.from), pb = barOf.get(e.to);
      if (a === undefined || b === undefined || !pa || !pb) continue;
      if (Math.max(a, b) < first || Math.min(a, b) > last) continue;
      const ra = live(pa), rb = live(pb);
      const x1 = labelW + dayToX(ra.endDay + 1, win, zoom), x2 = labelW + dayToX(rb.startDay, win, zoom);
      const y1 = HEAD_H + a * LINE_H + D.top + D.bar / 2, y2 = HEAD_H + b * LINE_H + D.top + D.bar / 2;
      const yb = y1 + (y2 > y1 ? 1 : -1) * (LINE_H / 2);
      const d = x2 - x1 >= 16 ? `M${x1} ${y1} H${x1 + 8} V${y2} H${x2}` : `M${x1} ${y1} H${x1 + 8} V${yb} H${x2 - 8} V${y2} H${x2}`;
      out.push({ key: `${e.from}>${e.to}`, d, clash: pb !== undefined && ra.endDay >= rb.startDay, active: chain?.edges.has(e) ?? false, dim: chain !== null && !chain.edges.has(e) });
      if (out.length >= MAX_EDGES) break;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.edges, lineIndex, barOf, first, last, zoom, win, labelW, LINE_H, D.top, D.bar, chain, drag, staged]);

  // ---- export (a picture of every row, not only the rows in view)
  const [exportNote, setExportNote] = useState("");
  const exportCanvas = () => {
    const items: ExportLine[] = lines.map((l): ExportLine => {
      if (l.kind === "group") {
        const members = l.members.map((id) => rowOf.get(id)).filter((r): r is GridItem => !!r);
        const roll = rollup(members, barOf, today);
        return { kind: "group", level: l.level, label: l.label, count: l.count, flags: roll.text === "No flags" ? "" : roll.text, span: l.span, progress: roll.progress };
      }
      const row = rowOf.get(l.itemId)!, bar = barOf.get(l.itemId)!, plan = plans.get(l.itemId);
      const gate = gateMarker(row);
      return {
        kind: "item", level: l.level, code: String(row.item_code), name: String(row.initiative_name), health: row.health ? String(row.health) : "", bar,
        progress: typeof row.delivery_progress_pct === "number" ? Math.max(0, Math.min(100, row.delivery_progress_pct)) : null,
        note: plan?.overdue != null ? `Overdue ${plan.overdue} d` : plan?.endSlip != null && plan.endSlip > 0 ? `Finished ${plan.endSlip} d late` : null,
        gate: gate ? { day: gate.day, gate: gate.gate || "G" } : null, actual: plan?.actualLine ?? null,
      };
    });
    const edges = deps.edges.flatMap((e) => { const a = lineIndex.get(e.from), b = lineIndex.get(e.to); return a !== undefined && b !== undefined ? [{ from: a, to: b, clash: e.clash }] : []; });
    const out = renderGantt({ lines: items, win, zoom, labelW, lineH: LINE_H, todayDay: todayN, todayLabel: "Today", ticks, years, edges });
    if ("error" in out) { setExportNote(out.error); return null; }
    setExportNote("");
    return out.canvas;
  };
  const stamp = fromDay(todayN);
  const exportPng = () => { const c = exportCanvas(); if (c) { downloadPng(c, `gantt-${stamp}.png`); setExportNote("Picture saved."); } };
  const exportPdf = () => { const c = exportCanvas(); if (c) { printPicture(c, `Gantt ${stamp}`); setExportNote("Choose “Save as PDF” in the print window."); } };

  const hoverRow = hover ? (rowOf.get(hover.id) as GridItem | undefined) : undefined;
  const hoverBar = hover ? barOf.get(hover.id) : undefined;
  const groupsUsed = [g1, g2].filter(Boolean);
  const selList = [...sel];
  const shiftSel = (days: number) => { const d = groupDelta(selList, days); if (d === 0) { setAnnounce("They cannot move further: the timeline window ends there."); return; } commitGroup(selList, d); };
  return (
    <div className="gantt-page">
      <PageHeader chips={<>{def.filters.map((f, i) => (
        <span key={i} className="token-chip">
          {summarize(f, lookups)}{" "}
          <button type="button" className="chip-x" aria-label={`Remove filter ${summarize(f, lookups)}`} onClick={() => setFilters(def.filters.filter((_, j) => j !== i))}>×</button>
        </span>
      ))}</>} title="Gantt" views={<ViewBar api={viewsApi} />} count={`${bars.length} scheduled · ${unscheduled.length} unscheduled`} scope={scope.selection.kind !== "all" ? scope.label : null} note={filterName ? `filters of “${filterName}”` : null}>
        {baseMissing && <div className="view-dirty" role="status">This view is private to its owner or no longer exists. Showing Prioritisation.</div>}
      </PageHeader>

      <div className="pvbar" role="region" aria-label="Gantt tools">
        <div className="pvbar-s1">
          <FilterPanel filters={filters} onChange={setFilters} lookups={lookups} quarters={controller.rows.map((r) => r.g2m_quarter)} openValues={(k) => controller.openValues(k)} today={today} matching={rows.length} total={controller.rows.length} />
          <label className="pvbar-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5b6272" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
            <input type="search" aria-label="Search initiatives" placeholder="Search initiatives" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setSearch(""); }} />
          </label>
          <div className="gantt-tools">
            <ChoiceMenu name="Group by" value={g1} none="No grouping" choices={groupOptions.map((o) => ({ value: o.key, label: o.label }))} onChange={setG1} />
            <ChoiceMenu name="Then by" value={g1 ? g2 : ""} none="None" disabled={!g1} choices={groupOptions.filter((o) => o.key !== g1).map((o) => ({ value: o.key, label: o.label }))} onChange={setG2} />
            <div role="group" aria-label="Zoom" className="gantt-zoom">
              {ZOOMS.map((z) => <button key={z} type="button" className={zoom === z ? "view-chip view-chip-on" : "view-chip"} aria-pressed={zoom === z} onClick={() => setZoom(z)}>{ZOOM_LABEL[z]}</button>)}
              <button type="button" className="view-chip" onClick={fit} title="Choose the zoom that shows the whole timeline">Fit</button>
            </div>
            <button type="button" className="tool-btn" onClick={() => { touched.current = true; scrollRef.current?.scrollTo({ left: Math.max(0, labelW + todayX - 400), behavior: "smooth" }); }}>Today</button>
          </div>
        </div>
        <div className="pvbar-s1 gantt-tools2">
          <div role="group" aria-label="Row height" className="gantt-zoom">
            {(["compact", "comfortable"] as const).map((d) => <button key={d} type="button" className={density === d ? "view-chip view-chip-on" : "view-chip"} aria-pressed={density === d} onClick={() => setDensity(d)}>{d === "compact" ? "Compact" : "Comfortable"}</button>)}
          </div>
          <button type="button" className="tool-btn" disabled={groupIds.length === 0} onClick={() => setCollapsed(collapsed.size >= groupIds.length && groupIds.length > 0 ? new Set() : new Set(groupIds))}>{collapsed.size >= groupIds.length && groupIds.length > 0 ? "Expand all" : "Collapse all"}</button>
          <button type="button" className="tool-btn" onClick={exportPng}>Export PNG</button>
          <button type="button" className="tool-btn" onClick={exportPdf}>Export PDF</button>
          {exportNote && <span role="status" className="muted gantt-export-note">{exportNote}</span>}
        </div>
      </div>

      {sel.size > 0 && (
        <div className="gantt-sel" role="region" aria-label="Selected bars">
          <strong>{sel.size} selected</strong>
          {sel.size > 1 && !lockReason && (
            <>
              <button type="button" className="tool-btn" onClick={() => shiftSel(-7)}>Move 1 week earlier</button>
              <button type="button" className="tool-btn" onClick={() => shiftSel(7)}>Move 1 week later</button>
              <span className="muted">or drag one of them: they move together as one change.</span>
            </>
          )}
          {sel.size === 1 && <span className="muted">Shift-click (or press S on) more bars to move them together.</span>}
          <button type="button" className="link-button" onClick={() => setSel(new Set())}>Clear selection</button>
        </div>
      )}

      <div className={peekId ? "gantt-split gantt-split-open" : "gantt-split"}>
        <div className="gantt-chart">
          <StatusStrip controller={controller} />
          <div ref={scrollRef} className="gantt-scroll" data-testid="gantt-scroll" tabIndex={-1} style={{ ["--label-w" as string]: `${labelW}px` }}>
            <div className="gantt-inner" style={{ width: labelW + width, height: HEAD_H + lines.length * LINE_H + 8 }}
              onDragOver={(e) => { if (canEdit && !lockReason) e.preventDefault(); }}
              onDrop={(e) => { const id = e.dataTransfer.getData("text/plain"); if (!id || lockReason) return; e.preventDefault(); schedule(id, dayAtClientX(e.clientX)); }}>
              <div className="gantt-head" style={{ width: labelW + width, height: HEAD_H }}>
                <div className="gl-corner" style={{ width: labelW }}>
                  Initiative
                  <span
                    className="gl-resize" role="separator" aria-orientation="vertical" aria-label="Resize the name column" aria-valuemin={LABEL_MIN} aria-valuemax={LABEL_MAX} aria-valuenow={labelW} tabIndex={0}
                    onPointerDown={(e) => {
                      e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                      const startX = e.clientX, startW = labelW;
                      const mv = (ev: PointerEvent) => setLabelW(Math.min(LABEL_MAX, Math.max(LABEL_MIN, Math.round(startW + ev.clientX - startX))));
                      const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
                      window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
                    }}
                    onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); setLabelW(Math.min(LABEL_MAX, Math.max(LABEL_MIN, labelW + (e.key === "ArrowRight" ? 16 : -16)))); } }}
                  />
                </div>
                {years.map((y) => <div key={y.label} className="gh-year" style={{ left: labelW + y.x, width: y.width }}>{y.label}</div>)}
                {ticks.map((t) => <div key={t.startDay} className="gh-tick" style={{ left: labelW + t.x, width: t.width }}>{t.label}</div>)}
                <div className="gh-today" aria-hidden="true" style={{ left: labelW + todayX }} title={`Today, ${formatDate(fromDay(todayN), today)}`}>Today</div>
              </div>
              <div className="gantt-grid" aria-hidden="true" style={{ left: labelW, top: HEAD_H, width, height: lines.length * LINE_H + 8 }}>
                {ticks.map((t) => <div key={t.startDay} className="gg-line" style={{ left: t.x }} />)}
              </div>
              <div className="gantt-today" aria-hidden="true" style={{ left: labelW + todayX, top: HEAD_H }} />
              <svg className="gantt-deps" aria-hidden="true" width={labelW + width} height={HEAD_H + lines.length * LINE_H + 8}>
                <defs>
                  <marker id="gdep-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="context-stroke" /></marker>
                </defs>
                {edgePaths.map((p) => <path key={p.key} d={p.d} className={`gdep${p.clash ? " gdep-clash" : ""}${p.active ? " gdep-active" : ""}${p.dim ? " gdep-dim" : ""}`} markerEnd="url(#gdep-arrow)" />)}
              </svg>
              {lines.slice(first, last).map((l, k) => renderLine(l, first + k))}
              {lines.length === 0 && <p className="gantt-empty muted" style={{ left: labelW + 20 }}>{rows.length === 0 ? "No initiatives in this scope." : "Nothing is scheduled yet. Drag an item from Unscheduled onto the timeline."}</p>}
            </div>
          </div>
          <div className="gantt-foot">
            <button type="button" className="link-button" onClick={() => setPad((p) => ({ ...p, before: p.before + 1 }))}>Show earlier months</button>
            <button type="button" className="link-button" onClick={() => setPad((p) => ({ ...p, after: p.after + 1 }))}>Show later months</button>
            <span className="muted">
              {groupsUsed.length === 0 ? "Not grouped" : `Grouped by ${groupsUsed.map((g) => groupOptions.find((o) => o.key === g)?.label).join(", then ")}`} · drag a bar to move it, drag an edge to change a date, Shift-click to select several · keys: ←→ move, Alt+←→ end date, Alt+Shift+←→ start date, S select, Enter saves, Esc cancels · Ctrl/⌘ + scroll zooms
            </span>
            {lockReason && <span role="note" className="muted"> · {lockReason}</span>}
          </div>
          <ul className="gantt-legend" aria-label="Legend">
            <li><i className="lg-sw health-bar-on-track" />On Track</li>
            <li><i className="lg-sw health-bar-at-risk" />At Risk</li>
            <li><i className="lg-sw health-bar-delayed" />Delayed</li>
            <li><i className="lg-sw health-bar-blocked" />Blocked</li>
            <li><i className="lg-sw health-bar-none" />No health set</li>
            <li><i className="lg-sw lg-fill" />Darker part: delivery progress</li>
            <li><i className="lg-actual" />Line under a bar: actual start to finish (or to today)</li>
            <li><i className="lg-gate" />Next gate (letter = gate), read only</li>
            <li><i className="lg-late" />“Overdue N d”: past G2M Date (est), not finished</li>
            <li><svg width="22" height="10" aria-hidden="true"><path d="M0 5 H18" stroke="#6f78a6" strokeWidth="1.5" /><path d="M14 1 L21 5 L14 9z" fill="#6f78a6" /></svg>Depends on (arrow points to the dependent)</li>
            <li><svg width="22" height="10" aria-hidden="true"><path d="M0 5 H18" stroke="#b4472f" strokeWidth="1.5" /><path d="M14 1 L21 5 L14 9z" fill="#b4472f" /></svg>Starts before what it waits for ends</li>
          </ul>
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
                        {canEdit && !lockReason && <button type="button" className="btn" onClick={() => schedule(u.id, todayN)} aria-label={`Schedule ${row.item_code} from today`}>Schedule from today</button>}
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

      {hover && hoverRow && hoverBar && !drag && (() => {
        const plan = plans.get(hoverRow.id), gate = gateMarker(hoverRow), dc = deps.counts.get(hoverRow.id), unplaced = deps.unplaced.get(hoverRow.id) ?? [];
        const days = hoverBar.endDay - hoverBar.startDay + 1;
        const teams = teamsOf(hoverRow), owner = memberName(hoverRow.product_manager);
        const progress = typeof hoverRow.delivery_progress_pct === "number" ? Math.round(hoverRow.delivery_progress_pct) : null;
        const left = Math.max(8, Math.min(hover.x, (typeof window === "undefined" ? 1200 : window.innerWidth) - 340));
        const flip = typeof window !== "undefined" && hover.y > window.innerHeight - 260;
        return (
          <div className="gcard" aria-hidden="true" data-testid="gantt-card" style={{ left, top: flip ? undefined : hover.y, bottom: flip ? (typeof window === "undefined" ? 0 : window.innerHeight - hover.y + 34) : undefined }}>
            <div className="gcard-top"><span className="mono muted">{hoverRow.item_code}</span>{hoverRow.health ? <StatusPill value={String(hoverRow.health)} /> : <span className="muted">No health set</span>}</div>
            <div className="gcard-name">{String(hoverRow.initiative_name)}</div>
            <dl className="gcard-list">
              <dt>Plan</dt><dd>{formatDate(hoverBar.start, today)} to {formatDate(hoverBar.end, today)} ({daysText(days)})</dd>
              {plan?.actualStart != null && <><dt>Actual</dt><dd>Started {formatDate(fromDay(plan.actualStart), today)}{plan.actualEnd != null ? `, finished ${formatDate(fromDay(plan.actualEnd), today)}` : ", still running"}</dd></>}
              {plan && plan.notes.length > 0 && <><dt>Against plan</dt><dd className={plan.overdue != null || (plan.endSlip ?? 0) > 0 ? "gcard-bad" : ""}>{plan.notes.join(". ")}</dd></>}
              {hoverRow.initiative_phase ? <><dt>Phase</dt><dd>{String(hoverRow.initiative_phase)}</dd></> : null}
              {gate && <><dt>Next gate</dt><dd>{gate.text}</dd></>}
              {owner && <><dt>Product manager</dt><dd>{owner}</dd></>}
              {hoverRow.effort ? <><dt>Effort</dt><dd>{String(hoverRow.effort)}</dd></> : null}
              {teams.length > 0 && <><dt>Teams</dt><dd>{teams.join(", ")}</dd></>}
              {progress !== null && <><dt>Delivery</dt><dd>{progress}%</dd></>}
              {dc && <><dt>Depends on</dt><dd>{String(hoverRow.depends_on)}{dc.clashes > 0 ? ` (${dc.clashes} not finished before this starts)` : ""}{unplaced.length > 0 ? `. Not drawn: ${unplaced.join(", ")} (not scheduled or not in this view)` : ""}</dd></>}
            </dl>
            <div className="gcard-hint muted">Click to open · drag to move · Shift-click to select</div>
          </div>
        );
      })()}
    </div>
  );
}
