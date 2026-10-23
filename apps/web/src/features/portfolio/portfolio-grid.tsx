"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ClientSideRowModelApiModule, ClientSideRowModelModule, CellApiModule, CellStyleModule, ColumnApiModule, CustomEditorModule,
  EventApiModule, ModuleRegistry, RowApiModule, RowSelectionModule, ScrollApiModule, TextEditorModule, themeQuartz, type CellClickedEvent, type CellDoubleClickedEvent, type CellFocusedEvent, type CellKeyDownEvent, type ColumnMovedEvent, type GridApi,
} from "ag-grid-community";
import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import {
  buildGroupedRows, CORE_COLUMN_KEYS, FIELD_BY_KEY, FIELDS, groupableFields, matchesFilters, matchesSearch, sanitizeView, VIEW_NAMES, WAITING_IN_VIEW, type EditableField, type Filter, type GroupRow, type ViewDef,
} from "@pv/domain";
import { useWorkspace } from "../workspace/provider";
import { setQueryParam, useScope } from "../workspace/scope";
import { buildColumns, isEditableColumn, isReadOnlyColumn } from "./columns";
import { ColumnsPicker } from "./columns-picker";
import { ItemPanel } from "./item-panel";
import { ALL_COLUMNS_NAME, baseDef, baseLabel, baseParam, parseBase, sameView, type BaseView } from "./grid-view";
import { CommandPalette } from "./command-palette";
import type { Command } from "./palette";
import { FiltersMenu, GroupMenu, summarize, ViewsMenu } from "./view-controls";
import { downloadCsv, selectionToCsv } from "./export-selection";
import { BulkBar } from "./bulk-bar";
import { ImportDialog } from "./import-dialog";
import { QuickAddBar } from "./quick-add-bar";
import type { PortfolioController } from "./controller";
import { StatusStrip, useStatus } from "./status-strip";
import type { GridItem, Lookups } from "./types";

ModuleRegistry.registerModules([
  ClientSideRowModelModule, ClientSideRowModelApiModule, TextEditorModule, CustomEditorModule, CellStyleModule,
  ColumnApiModule, CellApiModule, RowApiModule, EventApiModule, ScrollApiModule, RowSelectionModule,
]);

const theme = themeQuartz.withParams({
  fontFamily: "IBM Plex Sans, system-ui, sans-serif",
  fontSize: 13,
  headerFontSize: 12,
  headerFontWeight: 600,
  headerTextColor: "#374151",
  columnBorder: false,
  headerColumnBorder: false,
  rowBorder: { style: "solid", width: 1, color: "#F3F4F7" },
  selectedRowBackgroundColor: "#F4F7FE",
  rowHeight: 36,
  headerHeight: 28,
  accentColor: "#3347D9",
  borderColor: "#E6E9EF",
  headerBackgroundColor: "#F8F9FC",
  wrapperBorderRadius: 8,
  spacing: 6,
});

type GridProps = {
  controller: PortfolioController;
  lookups: Lookups;
  /** The view to start from when the address does not say. */
  initialBase?: BaseView;
  renderAllColumns?: boolean;
  /** Signed-in person, for "me" in filters. */
  me?: string | null;
  /** Page title and other server-rendered pieces of the page head. */
  headLeft?: ReactNode;
  headRight?: ReactNode;
};

const isGroup = (r: unknown): r is GroupRow => !!r && typeof r === "object" && (r as { __group?: boolean }).__group === true;

/** Full-width header row of a group: a toggle, the group's name and how many items it holds. */
function GroupRowRenderer(p: CustomCellRendererProps<GroupRow>) {
  const g = p.data;
  if (!g) return null;
  const toggle = (p.context as { toggleGroup: (key: string) => void }).toggleGroup;
  return (
    <div className="group-row">
      <button type="button" className="group-toggle" aria-expanded={!g.collapsed} aria-label={`${g.collapsed ? "Expand" : "Collapse"} group ${g.label}`} onClick={() => toggle(g.key)}>
        {g.collapsed ? "▸" : "▾"}
      </button>
      <span>{g.label}</span>
      <span className="group-count">{g.count} {g.count === 1 ? "item" : "items"}</span>
    </div>
  );
}

const getRowId = (p: { data: { id: string } }) => p.data.id;
const isFullWidthRow = (p: { rowNode: { data?: unknown } }) => isGroup(p.rowNode.data);
const DEFAULT_COL_DEF = { sortable: false, resizable: true, cellDataType: false } as const;
const ROW_SELECTION = { mode: "multiRow", checkboxes: true, headerCheckbox: true, enableClickSelection: false, isRowSelectable: (n: { data?: unknown }) => !isGroup(n.data) } as const;
const SELECTION_COLUMN = { pinned: "left", width: 46, suppressHeaderMenuButton: true } as const;

const PRIORITISATION: BaseView = { kind: "builtin", name: "Prioritisation" };

export function PortfolioGrid({ controller, lookups, initialBase = PRIORITISATION, renderAllColumns = false, me = null, headLeft, headRight }: GridProps) {
  const router = useRouter();
  const params = useSearchParams();
  const { views, defaults, scopes, projects, canEdit: canEditWorkspace } = useWorkspace();
  const scope = useScope();
  const apiRef = useRef<GridApi<GridItem> | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const quickAddRef = useRef<HTMLInputElement | null>(null);
  const [contextProject, setContextProject] = useState<string | null>(null);
  const [selected, setSelected] = useState<GridItem[]>([]);
  const [importText, setImportText] = useState<string | null>(null);
  const status = useStatus(controller);
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const headRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const footRef = useRef<HTMLParagraphElement | null>(null);
  const [gridHeight, setGridHeight] = useState<number | null>(null);
  // the item panel beside the grid: which item, kept in the address as ?item=R-12 so a refresh or a shared link opens it
  const [peekId, setPeekId] = useState<string | null>(() => {
    const code = params.get("item");
    return code ? controller.rows.find((r) => r.item_code === code)?.id ?? null : null;
  });
  const openPeek = useCallback((id: string | null) => {
    setPeekId(id);
    setQueryParam("item", id ? controller.row(id)?.item_code ?? null : null);
  }, [controller]);

  // The grid fills the page below it: a taller window gives a taller grid, and it follows window resizes
  // and changes in the bars above it (notices, quick-add hints, columns picker).
  useEffect(() => {
    const fit = () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const top = wrap.getBoundingClientRect().top + window.scrollY;
      const foot = footRef.current?.offsetHeight ?? 0;
      setGridHeight(Math.max(360, Math.floor(window.innerHeight - top - foot - 36)));
    };
    fit();
    window.addEventListener("resize", fit);
    const ro = new ResizeObserver(fit);
    for (const child of Array.from(cardRef.current?.children ?? [])) if (child !== wrapRef.current && !child.classList.contains("grid-split")) ro.observe(child);
    if (headRef.current) ro.observe(headRef.current);
    return () => { window.removeEventListener("resize", fit); ro.disconnect(); };
  }, []);
  // ---- the view: where it started (a default view, all columns or a saved view), plus changes made since
  const [base, setBase] = useState<BaseView>(() => parseBase(params.get("view"), initialBase));
  const [override, setOverride] = useState<ViewDef | null>(null);
  const savedDef = baseDef(base, views, defaults);
  const baseMissing = base.kind === "saved" && savedDef === null && views.length > 0; // a deleted view falls back
  const bDef = savedDef ?? baseDef(PRIORITISATION, [], defaults)!;
  const def = override ?? bDef;
  const dirty = override !== null && !sameView(override, bDef);
  const openBase = (b: BaseView) => { setBase(b); setOverride(null); setQueryParam("view", baseParam(b)); };
  const changeDef = (patch: Partial<ViewDef>) => setOverride(sanitizeView({ ...def, ...patch }));
  const visible = useMemo(() => new Set(def.columns), [def.columns]);
  const toggle = (key: string) => {
    if ((CORE_COLUMN_KEYS as readonly string[]).includes(key)) return;
    changeDef({ columns: visible.has(key) ? def.columns.filter((c) => c !== key) : [...def.columns, key] });
  };

  // ---- what rows show: scope, search, filters, grouping
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set()); // rows just added stay visible even if a filter would hide them
  const [tick, setTick] = useState(0);
  const today = controller.todayDate();
  const groupLabel = (field: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return "No value";
    if (field === "home_project") return lookups.projects.find((p) => p.id === value)?.name ?? String(value);
    if (FIELD_BY_KEY[field]?.type === "Person") return lookups.members.find((m) => m.user_id === value)?.email ?? String(value);
    return String(value);
  };
  const projectIds = scope.projectIds;
  const visibleRows = useMemo(
    () =>
      controller.rows.filter(
        (r) =>
          added.has(r.id) ||
          ((projectIds === null || projectIds.includes(r.home_project)) && matchesSearch(r, search) && matchesFilters(r, def.filters, { me, today })),
      ),
    // tick: the controller changes its rows in place, so a rebuild is requested by hand
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, tick, projectIds, search, def.filters, added, me],
  );
  const displayRows = useMemo(
    () => buildGroupedRows(visibleRows, def.groupBy, collapsed, groupLabel),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleRows, def.groupBy, collapsed, lookups],
  );
  const toggleGroup = useCallback((key: string) => setCollapsed((c) => { const n = new Set(c); if (!n.delete(key)) n.add(key); return n; }), []);
  const gridContext = useMemo(() => ({ toggleGroup }), [toggleGroup]);
  const resetShown = () => setAdded(new Set());
  const setFilters = (filters: Filter[]) => { resetShown(); changeDef({ filters }); };
  const setSearchText = (t: string) => { resetShown(); setSearch(t); };

  const columnDefs = useMemo(
    () => buildColumns({ controller, lookups, today: () => controller.todayDate(), visible, order: def.columns, sorted: def.groupBy === null }),
    [controller, lookups, visible, def.columns, def.groupBy],
  );
  const exportFields = useMemo(() => def.columns.map((k) => FIELD_BY_KEY[k]!).filter(Boolean), [def.columns]);
  const showLater = def.columns.some((k) => (FIELD_BY_KEY[k]?.phase ?? 1) > 1 && k !== "project_rank");
  const filtered = visibleRows.length !== controller.rows.length;

  // A row whose rank changed jumps to its new place: keep the keyboard focus on it.
  useEffect(
    () =>
      controller.onFocusRequest((id) => {
        setTimeout(() => {
          const api = apiRef.current;
          const node = api?.getRowNode(id);
          if (api && node && node.rowIndex != null) {
            api.ensureNodeVisible(node, "middle");
            api.setFocusedCell(node.rowIndex, "stack_rank");
          }
        }, 0);
      }),
    [controller],
  );

  // Added and removed rows (quick-add, import and their undo): rebuild what is shown, and scroll to the last one added.
  const scrollToRef = useRef<string | null>(null);
  useEffect(
    () =>
      controller.onStructure((add, remove) => {
        setAdded((prev) => {
          const n = new Set(prev);
          for (const r of add) n.add(r.id);
          for (const r of remove) n.delete(r.id);
          return n;
        });
        setTick((t) => t + 1);
        const last = add[add.length - 1];
        if (last) scrollToRef.current = last.id;
      }),
    [controller],
  );
  useEffect(() => {
    const id = scrollToRef.current;
    const api = apiRef.current;
    if (!id || !api) return;
    const go = () => { const node = api.getRowNode(id); if (node) { api.ensureNodeVisible(node, "bottom"); scrollToRef.current = null; return true; } return false; };
    if (!go()) setTimeout(go, 60);
  }, [displayRows]);

  const groupedRef = useRef(false);
  useEffect(() => { groupedRef.current = def.groupBy !== null; }, [def.groupBy]);

  // Rows are changed in place by the controller; tell the grid which ones. Grouped rows are placed again.
  useEffect(
    () =>
      controller.subscribe((changed) => {
        const api = apiRef.current;
        if (!api) return;
        const here = changed.filter((r) => api.getRowNode(r.id));
        if (here.length > 0) api.applyTransaction({ update: here });
        if (here.length > 0 && groupedRef.current) setTick((t) => t + 1);
      }),
    [controller],
  );

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (controller.status.pending > 0) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [controller]);

  const onCellKeyDown = (e: CellKeyDownEvent<GridItem>) => {
    const ke = e.event as KeyboardEvent | null;
    const colId = e.column.getColId();
    if (!ke || !e.data) return;
    if (e.api.getEditingCells().length > 0) return;
    if (ke.key === " " && !ke.ctrlKey && !ke.metaKey && !ke.altKey && !isGroup(e.data) && colId !== "ag-Grid-SelectionColumn") {
      ke.preventDefault(); // Space opens the item panel (the page would scroll otherwise)
      openPeek(e.data.id);
      return;
    }
    if (isReadOnlyColumn(colId) && (ke.key === "Enter" || ke.key === "F2" || ke.key === "Delete" || ke.key === "Backspace" || ke.key.length === 1)) {
      if (ke.key.length === 1 && (ke.metaKey || ke.ctrlKey)) return; // copy etc.
      controller.notifyReadOnly(colId);
      return;
    }
    if (!controller.canEdit && (ke.key === "Enter" || ke.key === "F2" || ke.key === "Delete")) {
      controller.edit(e.data.id, "initiative_name", e.data.initiative_name); // shows the view-only message
      return;
    }
    if ((ke.key === "Delete" || ke.key === "Backspace") && isEditableColumn(colId)) {
      ke.preventDefault();
      const r = controller.clearCell(e.data.id, colId as EditableField);
      if (!r.ok) controller.notify(r.error);
    }
  };

  // The grid reads its handlers once: new function props on every render make it redo work on every edit.
  // They are stable wrappers that call the latest handlers.
  const latest = useRef({ onCellKeyDown, columns: [] as string[], visible: new Set<string>(), changeDef: (() => {}) as (patch: Partial<ViewDef>) => void });
  useEffect(() => { latest.current = { onCellKeyDown, columns: def.columns, visible, changeDef }; });
  const onCellKeyDownStable = useCallback((e: CellKeyDownEvent<GridItem>) => latest.current.onCellKeyDown(e), []);
  const onSelectionChanged = useCallback((e: { api: GridApi<GridItem> }) => setSelected(e.api.getSelectedRows()), []);
  const onColumnMoved = useCallback((e: ColumnMovedEvent<GridItem>) => {
    if (!e.finished || e.source !== "uiColumnMoved") return;
    const { columns, visible: vis, changeDef: change } = latest.current;
    const ids = e.api.getAllDisplayedColumns().map((c) => c.getColId()).filter((id) => id in FIELD_BY_KEY && vis.has(id));
    if (ids.join() !== columns.filter((c) => ids.includes(c)).join()) change({ columns: ids });
  }, []);
  const onGridReady = useCallback((e: { api: GridApi<GridItem> }) => { apiRef.current = e.api; }, []);
  const onCellFocused = useCallback((e: CellFocusedEvent<GridItem>) => {
    const row = e.rowIndex == null ? null : e.api.getDisplayedRowAtIndex(e.rowIndex)?.data;
    if (row && !isGroup(row)) setContextProject(row.home_project);
  }, []);
  const onCellDoubleClicked = useCallback((e: CellDoubleClickedEvent<GridItem>) => {
    const colId = e.column.getColId();
    if (isReadOnlyColumn(colId)) controller.notifyReadOnly(colId);
    else if (!controller.canEdit) controller.notify("You have view-only access. Ask an admin for the Creator role to edit.");
  }, [controller]);

  // clicking the code (R-12) of an initiative opens its panel; the name stays a cell you select and edit
  const onCellClicked = useCallback((e: CellClickedEvent<GridItem>) => {
    const colId = e.column.getColId();
    if (colId === "item_code" && e.data && !isGroup(e.data) && e.api.getEditingCells().length === 0) openPeek(e.data.id);
  }, [openPeek]);

  /** Items in the order the grid shows them now (scope, search, filters and grouping applied; rows in collapsed groups and group headers left out). */
  const orderedIds = useMemo(() => displayRows.filter((r) => !isGroup(r)).map((r) => (r as GridItem).id), [displayRows]);
  const step = useCallback((delta: 1 | -1) => {
    if (orderedIds.length === 0 || !peekId) return;
    const i = orderedIds.indexOf(peekId);
    const next = orderedIds[i < 0 ? 0 : Math.min(orderedIds.length - 1, Math.max(0, i + delta))]!;
    if (next === peekId) return;
    openPeek(next);
    const api = apiRef.current;
    const node = api?.getRowNode(next);
    if (api && node && node.rowIndex != null) { api.ensureNodeVisible(node, "middle"); api.setFocusedCell(node.rowIndex, "initiative_name"); }
  }, [orderedIds, peekId, openPeek]);
  const peekPosition = useMemo(() => {
    const i = peekId ? orderedIds.indexOf(peekId) : -1;
    return i < 0 ? undefined : { index: i, total: orderedIds.length };
  }, [peekId, orderedIds]);

  // J and K move to the next and previous initiative, Esc closes the panel; not while typing or in a menu or dialog
  useEffect(() => {
    if (!peekId) return;
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t !== document.body && !t.closest(".grid-card")) return;
      if (t.closest("input, textarea, select, [contenteditable=true], [role=dialog], [role=menu], .ag-cell-edit-wrapper, .ag-popup")) return;
      const go = e.key === "j" || e.key === "J" ? 1 : e.key === "k" || e.key === "K" ? -1 : 0;
      if (e.key === "Escape") { e.preventDefault(); openPeek(null); }
      else if (go !== 0) { e.preventDefault(); e.stopPropagation(); step(go); } // before the grid starts editing the cell with that letter
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [peekId, openPeek, step]);

  const onWrapperKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (e.key === "Escape" && !t.closest("input, textarea, select, [role=dialog], .set-menu") && selected.length > 0) { apiRef.current?.deselectAll(); return; }
    if (t.closest("input, textarea, [contenteditable=true]")) return; // let text fields keep their own undo
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); void controller.undo(); }
    else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); void controller.redo(); }
  };

  // commands ask for the focus by state; an effect (not the render) touches the inputs
  const [focusReq, setFocusReq] = useState<{ target: "add" | "search"; n: number } | null>(null);
  useEffect(() => { if (focusReq) (focusReq.target === "add" ? quickAddRef : searchRef).current?.focus(); }, [focusReq]);
  const focusQuickAdd = useCallback(() => setFocusReq({ target: "add", n: Date.now() }), []);
  const focusSearch = useCallback(() => setFocusReq({ target: "search", n: Date.now() }), []);

  // Alt+N (Option+N) jumps to the quick-add row from anywhere on the page.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === "KeyN" && controller.canEdit) { e.preventDefault(); setFocusReq({ target: "add", n: Date.now() }); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [controller]);

  // ---- command palette (Ctrl+K / ⌘K)
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen(true); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const locate = (id: string) => {
    const api = apiRef.current;
    const node = api?.getRowNode(id);
    if (!api || !node || node.rowIndex == null) {
      const row = controller.row(id);
      controller.notify(`${row?.item_code ?? "That item"} is hidden by the scope, search or filters. Clear them to see it.`);
      return;
    }
    api.ensureNodeVisible(node, "middle");
    api.setFocusedCell(node.rowIndex, "initiative_name");
  };
  const exportAll = () => downloadCsv(`roadmap-${new Date().toISOString().slice(0, 10)}.csv`, selectionToCsv(visibleRows, exportFields, lookups));
  const commands = useMemo<Command[]>(() => {
    const out: Command[] = [];
    if (controller.canEdit && lookups.projects.length > 0) out.push({ id: "add", label: "Add initiative", group: "Actions", keywords: "new create quick add", hint: "Alt+N", run: focusQuickAdd });
    out.push({ id: "search", label: "Search initiatives", group: "Actions", keywords: "find filter", run: focusSearch });
    for (const n of VIEW_NAMES) out.push({ id: `view:${n}`, label: `Go to view: ${n}`, group: "Views", keywords: "columns", run: () => openBase({ kind: "builtin", name: n }) });
    out.push({ id: "view:all", label: `Go to view: ${ALL_COLUMNS_NAME}`, group: "Views", keywords: "every field", run: () => openBase({ kind: "all" }) });
    for (const v of views) out.push({ id: `view:${v.id}`, label: `Go to view: ${v.name}`, group: "Saved views", run: () => openBase({ kind: "saved", id: v.id }) });
    out.push({ id: "scope:all", label: "Show all projects", group: "Scope", keywords: "portfolio scope", run: () => scope.select({ kind: "all" }) });
    for (const sc of scopes) out.push({ id: `scope:${sc.id}`, label: `Go to scope: ${sc.name}`, group: "Scope", keywords: "portfolio", run: () => scope.select({ kind: "scope", id: sc.id }) });
    for (const p of projects) out.push({ id: `project:${p.id}`, label: `Show project: ${p.name}`, group: "Scope", run: () => scope.select({ kind: "project", id: p.id }) });
    out.push({ id: "group:none", label: "Group by: no grouping", group: "Grouping", run: () => changeDef({ groupBy: null }) });
    for (const f of groupableFields()) out.push({ id: `group:${f.key}`, label: `Group by ${f.name}`, group: "Grouping", run: () => changeDef({ groupBy: f.key }) });
    if (def.filters.length > 0) out.push({ id: "filters:clear", label: "Clear filters", group: "Filters", run: () => setFilters([]) });
    if (search) out.push({ id: "search:clear", label: "Clear search", group: "Filters", run: () => setSearchText("") });
    if (dirty) out.push({ id: "view:reset", label: "Reset view changes", group: "Views", run: () => setOverride(null) });
    if (controller.canEdit && lookups.projects.length > 0) out.push({ id: "import", label: "Import from spreadsheet", group: "Actions", keywords: "paste excel csv", run: () => setImportText("") });
    out.push({ id: "export", label: "Export shown rows to file", group: "Actions", keywords: "csv download", run: exportAll });
    if (controller.canEdit) {
      out.push({ id: "undo", label: "Undo last change", group: "Actions", hint: mac ? "⌘Z" : "Ctrl+Z", run: () => void controller.undo() });
      out.push({ id: "redo", label: "Redo", group: "Actions", run: () => void controller.redo() });
    }
    out.push({ id: "go:members", label: "Open Members", group: "Go to", run: () => router.push("/settings/members") });
    out.push({ id: "go:security", label: "Open Security", group: "Go to", run: () => router.push("/settings/security") });
    return out;
    // the commands are rebuilt when what they act on changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, lookups, views, scopes, projects, def, dirty, search, base, visibleRows, mac, focusQuickAdd, focusSearch]);
  const findItems = useMemo(
    () => (q: string) => controller.rows.filter((r) => matchesSearch(r, q)).slice(0, 6).map((r) => ({ id: r.id, label: `${r.item_code} ${r.initiative_name}`, run: () => locate(r.id) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, displayRows],
  );

  const contextForQuickAdd = contextProject ?? (projectIds && projectIds.length === 1 ? projectIds[0]! : null);
  const chipFor = (b: BaseView, name: string) => {
    const on = base.kind === b.kind && (b.kind === "builtin" ? base.kind === "builtin" && base.name === b.name : true);
    return (
      <button key={name} type="button" className={on ? "view-chip view-chip-on" : "view-chip"} aria-pressed={on} onClick={() => openBase(b)}
        title={b.kind === "all" ? `All ${FIELDS.length} fields` : b.kind === "builtin" && defaults[b.name] ? "Default view, changed by your workspace" : "Default view"}>
        {name}
      </button>
    );
  };

  return (
    <>
    <div ref={headRef} className="page-head">
      {headLeft}
      <div className="view-chips" role="group" aria-label="View">
        {VIEW_NAMES.map((n) => chipFor({ kind: "builtin", name: n }, n))}
        {chipFor({ kind: "all" }, ALL_COLUMNS_NAME)}
      </div>
      <span className="head-tools">
        <input
          ref={searchRef}
          className="search-box"
          type="search"
          aria-label="Search initiatives"
          placeholder="Search initiatives"
          value={search}
          onChange={(e) => setSearchText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") setSearchText(""); }}
        />
        <FiltersMenu filters={def.filters} onChange={setFilters} lookups={lookups} today={today} />
        <GroupMenu groupBy={def.groupBy} onChange={(g) => changeDef({ groupBy: g })} />
        <ViewsMenu base={base} views={views} defaults={defaults} def={def} dirty={dirty} onOpen={openBase} />
        {headRight}
        {controller.canEdit && lookups.projects.length > 0 && <button type="button" className="tool-btn" onClick={() => setImportText("")}>Import from spreadsheet</button>}
        <ColumnsPicker visible={visible} onToggle={toggle} customerSafe={def.customerSafe === true} />
        <button type="button" className="tool-btn" onClick={exportAll}>Export</button>
        <button type="button" className="tool-btn" onClick={() => setPaletteOpen(true)} title="Commands and search">Commands {mac ? "⌘K" : "Ctrl+K"}</button>
      </span>
      {(def.filters.length > 0 || scope.selection.kind !== "all") && (
        <div className="filter-chips" aria-label="Active scope and filters">
          {scope.selection.kind !== "all" && <span className="token-chip">Scope: {scope.label}</span>}
          {def.filters.map((f, i) => (
            <span key={i} className="token-chip">
              {summarize(f, lookups)}{" "}
              <button type="button" className="chip-x" aria-label={`Remove filter ${summarize(f, lookups)}`} onClick={() => setFilters(def.filters.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
        </div>
      )}
      {base.kind === "builtin" && WAITING_IN_VIEW[base.name].length > 0 && (
        <p className="view-note" role="note">
          {WAITING_IN_VIEW[base.name].length} more {WAITING_IN_VIEW[base.name].length === 1 ? "column" : "columns"} of this view arrive in later phases:{" "}
          {WAITING_IN_VIEW[base.name].slice(0, 4).map((f) => `${f.name} (phase ${f.phase})`).join(", ")}
          {WAITING_IN_VIEW[base.name].length > 4 ? ` and ${WAITING_IN_VIEW[base.name].length - 4} more` : ""}.
        </p>
      )}
      {(dirty || baseMissing) && (
        <div className="view-dirty" role="status">
          {baseMissing ? "That saved view no longer exists, showing Prioritisation." : `You changed this view (${baseLabel(base, views)}). The changes are not saved.`}
          {dirty && <button type="button" className="tool-btn" onClick={() => setOverride(null)}>Reset</button>}
          {dirty && canEditWorkspace && <span>Save them from Views.</span>}
        </div>
      )}
    </div>
    <section
      ref={cardRef}
      className="grid-card"
      aria-label="Roadmap"
      onKeyDownCapture={onWrapperKeyDown}
      onPaste={(e) => {
        // cells copied from a spreadsheet, pasted anywhere on the grid (not into a text box): open the import
        if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]") || !controller.canEdit) return;
        const pasted = e.clipboardData.getData("text");
        if (/[\t\n]/.test(pasted.trim())) { e.preventDefault(); setImportText(pasted); }
      }}
    >
      <StatusStrip controller={controller} />
      {controller.canEdit && lookups.projects.length > 0 && (
        <QuickAddBar controller={controller} lookups={lookups} contextProject={contextForQuickAdd} inputRef={quickAddRef} />
      )}
      {selected.length > 0 && <BulkBar controller={controller} lookups={lookups} selected={selected} exportFields={exportFields} onClear={() => apiRef.current?.deselectAll()} onSelectAll={() => apiRef.current?.selectAll()} total={visibleRows.length} />}
      {importText !== null && (
        <ImportDialog controller={controller} lookups={lookups} defaultProject={contextForQuickAdd} initialText={importText} onClose={() => setImportText(null)} />
      )}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} findItems={findItems} />
      <div className={peekId ? "grid-split grid-split-open" : "grid-split"}>
      <div ref={wrapRef} className="grid-wrap" data-testid="grid" style={gridHeight ? { height: gridHeight } : undefined}>
        <AgGridReact<GridItem>
          theme={theme}
          rowData={displayRows as unknown as GridItem[]}
          columnDefs={columnDefs}
          getRowId={getRowId}
          context={gridContext}
          isFullWidthRow={isFullWidthRow}
          fullWidthCellRenderer={GroupRowRenderer as never}
          defaultColDef={DEFAULT_COL_DEF}
          rowSelection={ROW_SELECTION}
          selectionColumnDef={SELECTION_COLUMN}
          onSelectionChanged={onSelectionChanged}
          onColumnMoved={onColumnMoved}
          enterNavigatesVerticallyAfterEdit
          suppressColumnVirtualisation={renderAllColumns}
          stopEditingWhenCellsLoseFocus
          onGridReady={onGridReady}
          onCellFocused={onCellFocused}
          onCellKeyDown={onCellKeyDownStable}
          headerHeight={showLater ? 46 : 28}
          onCellDoubleClicked={onCellDoubleClicked}
          onCellClicked={onCellClicked}
        />
      </div>
      {peekId && (
        <ItemPanel
          controller={controller} lookups={lookups} itemId={peekId} me={me} mode="peek" position={peekPosition}
          onClose={() => openPeek(null)} onPrev={() => step(-1)} onNext={() => step(1)} height={gridHeight ?? undefined}
        />
      )}
      </div>
      <p ref={footRef} className="grid-foot">
        {filtered ? `${visibleRows.length.toLocaleString("en-GB")} of ${controller.rows.length.toLocaleString("en-GB")} items shown` : `${controller.rows.length.toLocaleString("en-GB")} items`} · {def.groupBy ? `Grouped by ${FIELD_BY_KEY[def.groupBy]?.name}, rank order inside each group` : "Sorted by global Stack Rank"} · Alt+N adds an initiative · Enter edits a cell · Tab moves right · Esc cancels · Delete clears a cell · {mac ? "⌘Z" : "Ctrl+Z"} undoes · {mac ? "⌘K" : "Ctrl+K"} commands · A lock means the value comes from GitHub
        {status.pending > 0 ? "" : ""}
      </p>
    </section>
    </>
  );
}
