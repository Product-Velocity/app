"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ClientSideRowModelApiModule, ClientSideRowModelModule, CellApiModule, CellStyleModule, ColumnApiModule, CustomEditorModule,
  EventApiModule, ModuleRegistry, RowApiModule, RowSelectionModule, ScrollApiModule, TextEditorModule, themeQuartz, type CellKeyDownEvent, type GridApi,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { DEFAULT_VIEWS, FIELDS, type EditableField } from "@pv/domain";
import { buildColumns, CORE_COLUMNS, isEditableColumn, isReadOnlyColumn } from "./columns";
import { ColumnsPicker, ViewChips, type ViewChoice } from "./columns-picker";
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
  initialView?: ViewChoice;
  renderAllColumns?: boolean;
  /** Page title and other server-rendered pieces of the page head. */
  headLeft?: ReactNode;
  headRight?: ReactNode;
};

export function PortfolioGrid({ controller, lookups, initialView = "Prioritisation", renderAllColumns = false, headLeft, headRight }: GridProps) {
  const apiRef = useRef<GridApi<GridItem> | null>(null);
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

  // The grid fills the page below it: a taller window gives a taller grid, and it follows window resizes
  // and changes in the bars above it (notices, quick-add hints, columns picker).
  useEffect(() => {
    const fit = () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const top = wrap.getBoundingClientRect().top + window.scrollY;
      const foot = footRef.current?.offsetHeight ?? 0;
      setGridHeight(Math.max(360, Math.floor(window.innerHeight - top - foot - 28)));
    };
    fit();
    window.addEventListener("resize", fit);
    const ro = new ResizeObserver(fit);
    for (const child of Array.from(cardRef.current?.children ?? [])) if (child !== wrapRef.current) ro.observe(child);
    if (headRef.current) ro.observe(headRef.current);
    return () => { window.removeEventListener("resize", fit); ro.disconnect(); };
  }, []);
  const rowData = useMemo(() => [...controller.rows], [controller]);

  const [view, setView] = useState<ViewChoice>(initialView);
  const [visible, setVisible] = useState<ReadonlySet<string>>(() => new Set(initialView === "All columns" ? FIELDS.map((f) => f.key) : DEFAULT_VIEWS[initialView]));
  const pickView = (v: ViewChoice) => {
    setView(v);
    setVisible(new Set(v === "All columns" ? FIELDS.map((f) => f.key) : DEFAULT_VIEWS[v]));
  };
  const toggle = (key: string) => setVisible((cur) => {
    const next = new Set(cur);
    if (!next.delete(key)) next.add(key);
    return next;
  });
  const columnDefs = useMemo(
    () => buildColumns({ controller, lookups, today: () => controller.todayDate(), visible }),
    [controller, lookups, visible],
  );
  const exportFields = useMemo(() => FIELDS.filter((f) => visible.has(f.key) || (CORE_COLUMNS as readonly string[]).includes(f.key)), [visible]);
  const showLater = FIELDS.some((f) => f.phase > 1 && visible.has(f.key));

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

  // Added and removed rows (quick-add and its undo).
  useEffect(
    () =>
      controller.onStructure((add, remove) => {
        const api = apiRef.current;
        if (!api) return;
        api.applyTransaction({ add, remove });
        const last = add[add.length - 1];
        // after the grid has placed the new rows (sorted by rank), scroll to the last one
        if (last) setTimeout(() => { const node = api.getRowNode(last.id); if (node) api.ensureNodeVisible(node, "bottom"); }, 0);
      }),
    [controller],
  );

  // Rows are changed in place by the controller; tell the grid which ones.
  useEffect(
    () =>
      controller.subscribe((changed) => {
        if (changed.length > 0) apiRef.current?.applyTransaction({ update: changed });
      }),
    [controller],
  );

  // Alt+N (Option+N) jumps to the quick-add row from anywhere on the page.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === "KeyN" && controller.canEdit && quickAddRef.current) {
        e.preventDefault();
        quickAddRef.current.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [controller]);

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

  const onWrapperKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (e.key === "Escape" && !t.closest("input, textarea, select, [role=dialog], .set-menu") && selected.length > 0) { apiRef.current?.deselectAll(); return; }
    if (t.closest("input, textarea, [contenteditable=true]")) return; // let text fields keep their own undo
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); void controller.undo(); }
    else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); void controller.redo(); }
  };

  return (
    <>
    <div ref={headRef} className="page-head">
      {headLeft}
      <ViewChips view={view} onView={pickView} />
      <span className="chip">Ranked by global Stack Rank</span>
      <span className="head-tools">
        {headRight}
        {controller.canEdit && lookups.projects.length > 0 && <button type="button" className="tool-btn" onClick={() => setImportText("")}>Import from spreadsheet</button>}
        <ColumnsPicker visible={visible} onToggle={toggle} />
        <button type="button" className="tool-btn" onClick={() => downloadCsv(`roadmap-${new Date().toISOString().slice(0, 10)}.csv`, selectionToCsv(controller.rows, exportFields, lookups))}>Export</button>
      </span>
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
        <QuickAddBar controller={controller} lookups={lookups} contextProject={contextProject} inputRef={quickAddRef} />
      )}
      {selected.length > 0 && <BulkBar controller={controller} lookups={lookups} selected={selected} exportFields={exportFields} onClear={() => apiRef.current?.deselectAll()} onSelectAll={() => apiRef.current?.selectAll()} total={controller.rows.length} />}
      {importText !== null && (
        <ImportDialog controller={controller} lookups={lookups} defaultProject={contextProject} initialText={importText} onClose={() => setImportText(null)} />
      )}
      <div ref={wrapRef} className="grid-wrap" data-testid="grid" style={gridHeight ? { height: gridHeight } : undefined}>
        <AgGridReact<GridItem>
          theme={theme}
          rowData={rowData}
          columnDefs={columnDefs}
          getRowId={(p) => p.data.id}
          defaultColDef={{ sortable: false, resizable: true, suppressMovable: true, cellDataType: false }}
          suppressMovableColumns
          rowSelection={{ mode: "multiRow", checkboxes: true, headerCheckbox: true, enableClickSelection: false }}
          selectionColumnDef={{ pinned: "left", width: 46, suppressHeaderMenuButton: true }}
          onSelectionChanged={(e) => setSelected(e.api.getSelectedRows())}
          enterNavigatesVerticallyAfterEdit
          suppressColumnVirtualisation={renderAllColumns}
          stopEditingWhenCellsLoseFocus
          onGridReady={(e) => { apiRef.current = e.api; }}
          onCellFocused={(e) => {
            const row = e.rowIndex == null ? null : e.api.getDisplayedRowAtIndex(e.rowIndex)?.data;
            if (row) setContextProject(row.home_project);
          }}
          onCellKeyDown={onCellKeyDown}
          headerHeight={showLater ? 46 : 28}
          onCellDoubleClicked={(e) => {
            const colId = e.column.getColId();
            if (isReadOnlyColumn(colId)) controller.notifyReadOnly(colId);
            else if (!controller.canEdit) controller.notify("You have view-only access. Ask an admin for the Creator role to edit.");
          }}
        />
      </div>
      <p ref={footRef} className="grid-foot">
        {controller.rows.length.toLocaleString("en-GB")} items · Alt+N adds an initiative · Enter edits a cell · Tab moves right · Esc cancels · Delete clears a cell · {mac ? "⌘Z" : "Ctrl+Z"} undoes · A lock means the value comes from GitHub
        {status.pending > 0 ? "" : ""}
      </p>
    </section>
    </>
  );
}
