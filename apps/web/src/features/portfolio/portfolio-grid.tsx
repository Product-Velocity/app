"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ClientSideRowModelApiModule, ClientSideRowModelModule, CellApiModule, CellStyleModule, ColumnApiModule, CustomEditorModule,
  EventApiModule, ModuleRegistry, RowApiModule, TextEditorModule, themeQuartz, type CellKeyDownEvent, type GridApi,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { DEFAULT_VIEWS, FIELDS, type EditableField, type ViewName } from "@pv/domain";
import { buildColumns, isEditableColumn, isReadOnlyColumn } from "./columns";
import { ColumnsPicker } from "./columns-picker";
import type { PortfolioController } from "./controller";
import { StatusStrip, useStatus } from "./status-strip";
import type { GridItem, Lookups } from "./types";

ModuleRegistry.registerModules([
  ClientSideRowModelModule, ClientSideRowModelApiModule, TextEditorModule, CustomEditorModule, CellStyleModule,
  ColumnApiModule, CellApiModule, RowApiModule, EventApiModule,
]);

const theme = themeQuartz.withParams({
  fontFamily: "IBM Plex Sans, system-ui, sans-serif",
  fontSize: 13,
  headerFontSize: 12,
  headerFontWeight: 600,
  rowHeight: 32,
  headerHeight: 30,
  accentColor: "#3347D9",
  borderColor: "#E6E9EF",
  headerBackgroundColor: "#F8F9FC",
  wrapperBorderRadius: 8,
  spacing: 6,
});

export function PortfolioGrid({ controller, lookups, initialView = "Prioritisation", renderAllColumns = false }: { controller: PortfolioController; lookups: Lookups; initialView?: ViewName | "All columns"; renderAllColumns?: boolean }) {
  const apiRef = useRef<GridApi<GridItem> | null>(null);
  const status = useStatus(controller);
  const rowData = useMemo(() => [...controller.rows], [controller]);

  const [view, setView] = useState<ViewName | "All columns">(initialView);
  const [visible, setVisible] = useState<ReadonlySet<string>>(() => new Set(initialView === "All columns" ? FIELDS.map((f) => f.key) : DEFAULT_VIEWS[initialView]));
  const pickView = (v: ViewName | "All columns") => {
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

  // Rows are changed in place by the controller; tell the grid which ones.
  useEffect(
    () =>
      controller.subscribe((changed) => {
        if (changed.length > 0) apiRef.current?.applyTransaction({ update: changed });
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
    if (t.closest("input, textarea, [contenteditable=true]")) return; // let text fields keep their own undo
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); void controller.undo(); }
    else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); void controller.redo(); }
  };

  return (
    <section className="grid-card" aria-label="Roadmap" onKeyDownCapture={onWrapperKeyDown}>
      <StatusStrip controller={controller} />
      <ColumnsPicker view={view} visible={visible} onView={pickView} onToggle={toggle} />
      <div className="grid-wrap" data-testid="grid">
        <AgGridReact<GridItem>
          theme={theme}
          rowData={rowData}
          columnDefs={columnDefs}
          getRowId={(p) => p.data.id}
          defaultColDef={{ sortable: false, resizable: true, suppressMovable: true, cellDataType: false }}
          suppressMovableColumns
          enterNavigatesVerticallyAfterEdit
          suppressColumnVirtualisation={renderAllColumns}
          stopEditingWhenCellsLoseFocus
          onGridReady={(e) => { apiRef.current = e.api; }}
          onCellKeyDown={onCellKeyDown}
          headerHeight={showLater ? 46 : 32}
          onCellDoubleClicked={(e) => {
            const colId = e.column.getColId();
            if (isReadOnlyColumn(colId)) controller.notifyReadOnly(colId);
            else if (!controller.canEdit) controller.notify("You have view-only access. Ask an admin for the Creator role to edit.");
          }}
        />
      </div>
      <p className="grid-foot">
        {controller.rows.length.toLocaleString("en-GB")} items · ranked by global Stack Rank · Enter or double-click to edit, Tab and Enter to move, Esc to cancel,
        Delete clears a cell
        {status.pending > 0 ? "" : ""}
      </p>
    </section>
  );
}
