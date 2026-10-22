"use client";

import type { ColDef } from "ag-grid-community";
import {
  EDITABLE_FIELDS, formatDate, formatValue, HEALTH_OPTIONS, LOCKED_FIELDS, MOSCOW_OPTIONS, optionLabel, SIZE_OPTIONS,
  type EditableField, type Health,
} from "@pv/domain";
import type { PortfolioController } from "./controller";
import { PickerEditor } from "./picker-editor";
import type { GridItem, Lookups } from "./types";

const HEALTH_SYMBOL: Record<Health, string> = { on_track: "✓", at_risk: "▲", delayed: "✖" };

/** Text label always, symbol and colour as extras (never colour alone). */
function HealthCell({ value }: { value: Health | null }) {
  if (!value) return null;
  return (
    <span className={`pill health-${value}`}>
      <span aria-hidden="true">{HEALTH_SYMBOL[value]}</span> {optionLabel("health", value)}
    </span>
  );
}

function LockedCell({ text, reason }: { text: string; reason: string }) {
  return <span title={reason}>{text}</span>;
}

export type ColumnContext = { controller: PortfolioController; lookups: Lookups; today: () => Date };

export function buildColumns({ controller, lookups, today }: ColumnContext): ColDef<GridItem>[] {
  const editable = () => controller.canEdit;
  const projectOptions = lookups.projects.map((p) => ({ value: p.id, label: p.name }));
  const ownerOptions = lookups.members.map((m) => ({ value: m.user_id, label: m.email }));
  const setter = (field: EditableField) => (p: { data: GridItem; newValue: unknown }) =>
    controller.edit(p.data.id, field, p.newValue == null ? "" : String(p.newValue)).ok &&
    // the controller already applied the value; tell the grid the cell changed
    true;

  const picker = (field: EditableField, options: { value: string; label: string }[], allowEmpty: boolean, emptyLabel?: string): Partial<ColDef<GridItem>> => ({
    editable,
    cellEditor: PickerEditor,
    cellEditorPopup: true,
    cellEditorParams: { options, allowEmpty, emptyLabel },
    valueSetter: setter(field) as never,
  });

  return [
    {
      colId: "stack_rank", field: "stack_rank", headerName: "Global", width: 78, sort: "asc", sortable: false,
      editable, cellClass: "num cell-key-col",
      valueFormatter: (p) => `#${p.value}`,
      valueSetter: (p) => {
        controller.editRank(p.data.id, String(p.newValue ?? "").replace(/^#/, ""));
        return false; // the controller updated the rows; the grid refreshes from its change events
      },
    },
    { colId: "project_rank", field: "project_rank", headerName: "In project", width: 86, cellClass: "num muted", valueFormatter: (p) => `#${p.value}` },
    { colId: "key", field: "key", headerName: "ID", width: 78, cellClass: "mono muted" },
    {
      colId: "title", field: "title", headerName: "Initiative", flex: 1, minWidth: 280, editable,
      valueSetter: setter("title") as never,
    },
    {
      colId: "home_project_id", field: "home_project_id", headerName: "Project", width: 150,
      valueFormatter: (p) => lookups.projects.find((x) => x.id === p.value)?.name ?? "",
      ...picker("home_project_id", projectOptions, false),
    },
    {
      colId: "owner_user_id", field: "owner_user_id", headerName: "Owner", width: 190,
      valueFormatter: (p) => lookups.members.find((x) => x.user_id === p.value)?.email ?? "",
      ...picker("owner_user_id", ownerOptions, true, "Unassigned"),
    },
    {
      colId: "moscow", field: "moscow", headerName: "MoSCoW", width: 100,
      valueFormatter: (p) => optionLabel("moscow", p.value),
      ...picker("moscow", MOSCOW_OPTIONS, true),
    },
    { colId: "size", field: "size", headerName: "Size", width: 78, ...picker("size", SIZE_OPTIONS, true) },
    {
      colId: "health", field: "health", headerName: "Health", width: 124,
      cellRenderer: HealthCell,
      ...picker("health", HEALTH_OPTIONS, true),
    },
    {
      colId: "value", field: "value", headerName: "Value", width: 104, editable, cellClass: "num",
      valueFormatter: (p) => formatValue(p.value),
      valueSetter: setter("value") as never,
      cellEditorParams: { useFormatter: true },
    },
    {
      colId: "confidence", field: "confidence", headerName: "Conf.", width: 78, editable, cellClass: "num",
      valueFormatter: (p) => (p.value == null ? "" : `${p.value}%`),
      valueSetter: setter("confidence") as never,
    },
    {
      colId: "start_date", field: "start_date", headerName: "Start", width: 104, editable,
      valueFormatter: (p) => formatDate(p.value, today()),
      valueSetter: setter("start_date") as never,
      cellEditorParams: { useFormatter: true },
    },
    {
      colId: "end_date", field: "end_date", headerName: "End", width: 104, editable,
      valueFormatter: (p) => formatDate(p.value, today()),
      valueSetter: setter("end_date") as never,
      cellEditorParams: { useFormatter: true },
    },
    {
      colId: "status", field: "status", headerName: "Status (GitHub)", width: 132, editable: false,
      cellClass: "cell-locked", headerClass: "header-locked",
      cellRenderer: (p: { value: string | null }) => <LockedCell text={p.value ?? "Not on GitHub"} reason={LOCKED_FIELDS.status} />,
    },
    {
      colId: "delivery_progress", field: "delivery_progress", headerName: "Progress (GitHub)", width: 148, editable: false,
      cellClass: "cell-locked num", headerClass: "header-locked",
      cellRenderer: (p: { value: number | null }) => <LockedCell text={p.value == null ? "" : `${p.value}%`} reason={LOCKED_FIELDS.delivery_progress} />,
    },
  ];
}

export const LOCKED_COLUMN_IDS = Object.keys(LOCKED_FIELDS) as (keyof typeof LOCKED_FIELDS)[];
export const EDITABLE_COLUMN_IDS: string[] = [...EDITABLE_FIELDS];
