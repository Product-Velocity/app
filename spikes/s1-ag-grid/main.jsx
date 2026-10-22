import React, { forwardRef, useImperativeHandle, useRef, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  ModuleRegistry, ClientSideRowModelModule, RowSelectionModule, TextEditorModule, NumberEditorModule,
  SelectEditorModule, CustomEditorModule, UndoRedoEditModule, CsvExportModule, ValidationModule,
  CellStyleModule, ColumnAutoSizeModule, RowApiModule, CellApiModule, ColumnApiModule, PinnedRowModule,
  QuickFilterModule, TextFilterModule, NumberFilterModule, RowDragModule, EventApiModule, DateEditorModule,
} from "ag-grid-community";
import { AgGridReact, useGridCellEditor } from "ag-grid-react";

const N = Number(new URLSearchParams(location.search).get("n") || 2000);
ModuleRegistry.registerModules([
  ClientSideRowModelModule, RowSelectionModule, TextEditorModule, NumberEditorModule, SelectEditorModule,
  CustomEditorModule, UndoRedoEditModule, CsvExportModule, CellStyleModule, ColumnAutoSizeModule,
  RowApiModule, CellApiModule, ColumnApiModule, PinnedRowModule, QuickFilterModule, TextFilterModule,
  NumberFilterModule, RowDragModule, EventApiModule, DateEditorModule,
  ...(new URLSearchParams(location.search).get("validation") ? [ValidationModule] : []),
]);

const MOSCOW = ["Must", "Should", "Could", "Won't"];
const SIZES = ["XS", "S", "M", "L", "XL"];
const PEOPLE = Array.from({ length: 40 }, (_, i) => `Person ${i + 1}`);
const PROJECTS = ["Platform", "Marketplace", "Growth", "Payments", "Mobile", "Data"];
const rows = Array.from({ length: N }, (_, i) => ({
  id: i + 1, rank: i + 1, key: `R-${String(i + 1).padStart(4, "0")}`, title: `Initiative number ${i + 1} with a reasonably long title`,
  project: PROJECTS[i % 6], moscow: MOSCOW[i % 4], size: SIZES[i % 5], owner: PEOPLE[i % 40],
  value: (i * 37) % 100, confidence: (i * 13) % 100, health: ["On track", "At risk", "Delayed"][i % 3],
  start: "2026-01-01", end: "2026-03-31", status: ["Open", "In progress", "Done"][i % 3], progress: (i * 7) % 100,
}));

/** Custom picker editor: proves typed pickers (our own, Community has no rich select) work. */
const PickerEditor = ({ value, onValueChange }) => {
  const input = useRef(null);
  useGridCellEditor({ focusIn: () => { input.current?.focus(); input.current?.select(); } });
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  return (
    <input ref={input} value={value ?? ""} onChange={(e) => onValueChange(e.target.value)} style={{ width: "100%" }} />
  );
};

const locked = (p) => false; // GitHub-driven columns: never editable
const colDefs = [
  { field: "rank", width: 70, rowDrag: true, cellDataType: "number", editable: true },
  { field: "key", width: 90, editable: false, checkboxSelection: true, headerCheckboxSelection: true },
  { field: "title", width: 280, editable: true },
  { field: "project", width: 120, editable: true, cellEditor: "agSelectCellEditor", cellEditorParams: { values: PROJECTS } },
  { field: "moscow", headerName: "MoSCoW", width: 100, editable: true, cellEditor: "agSelectCellEditor", cellEditorParams: { values: MOSCOW } },
  { field: "size", width: 80, editable: true, cellEditor: "agSelectCellEditor", cellEditorParams: { values: SIZES } },
  { field: "owner", width: 130, editable: true, cellEditor: PickerEditor },
  { field: "value", width: 80, editable: true, cellDataType: "number" },
  { field: "confidence", width: 100, editable: true, cellDataType: "number" },
  { field: "health", width: 100, editable: true, cellEditor: "agSelectCellEditor", cellEditorParams: { values: ["On track", "At risk", "Delayed"] } },
  { field: "start", width: 110, editable: true },
  { field: "end", width: 110, editable: true },
  { field: "status", width: 110, editable: locked, headerName: "Status (GitHub)", cellStyle: { background: "#f3f4f7" } },
  { field: "progress", width: 110, editable: locked, headerName: "Progress (GitHub)", cellStyle: { background: "#f3f4f7" } },
];

window.__m = { changes: 0, lat: [] };
function App() {
  const api = useRef(null);
  return (
    <AgGridReact
      rowData={rows}
      columnDefs={colDefs}
      getRowId={(p) => String(p.data.id)}
      rowHeight={32}
      headerHeight={34}
      rowSelection={{ mode: "multiRow", checkboxes: false, headerCheckbox: false, enableClickSelection: false }}
      undoRedoCellEditing
      undoRedoCellEditingLimit={20}
      enterNavigatesVertically
      enterNavigatesVerticallyAfterEdit
      stopEditingWhenCellsLoseFocus
      suppressCellFocus={false}
      onGridReady={(e) => { api.current = e.api; window.__api = e.api; window.__ready = performance.now(); }}
      onFirstDataRendered={() => { window.__first = performance.now(); }}
      onCellValueChanged={(e) => {
        window.__m.changes++; (window.__m.cols ||= {})[e.colDef.field] = ((window.__m.cols ||= {})[e.colDef.field] || 0) + 1;
        const t0 = window.__enterAt; if (t0) requestAnimationFrame(() => requestAnimationFrame(() => window.__m.lat.push(performance.now() - t0)));
      }}
    />
  );
}
document.addEventListener("keydown", (e) => { if (e.key === "Enter") window.__enterAt = performance.now(); }, true);
createRoot(document.getElementById("root")).render(<App />);
