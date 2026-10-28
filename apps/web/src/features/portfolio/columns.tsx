"use client";

import type { ColDef, IHeaderParams } from "ag-grid-community";
import {
  EDITABLE_FIELDS, FIELDS, isOpenableUrl, isShipped, optionsFor, readOnlyReason, trackerIssueLabel,
  type EditableField, type FieldDef,
} from "@pv/domain";
import type { PortfolioController } from "./controller";
import { formatField } from "./format";
import { markdownToPlainText } from "./markdown-text";
import { MarkdownTooltip } from "./markdown-tooltip";
import { DateEditor } from "./date-editor";
import { PickerEditor, type PickerOption } from "./picker-editor";
import type { GridItem, Lookups } from "./types";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, "-");

/** A compact pill with the word and no icon: the label is the signal, colour is only an extra (never colour alone). */
function HealthCell({ value }: { value: string | null }) {
  if (!value) return null;
  return (
    <span className={`pill health-${slug(value)}`}>
      {value}
    </span>
  );
}

function ReadOnlyCell({ text, reason, github }: { text: string; reason: string | null; github: boolean }) {
  return (
    <span className="lock-cell" title={reason ?? undefined}>
      {github && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2.4" role="img" aria-label="Set from GitHub">
          <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      )}
      {text}
    </span>
  );
}

/** Column header: the field name, plus a words-only note when the field is read-only or from a later phase. */
function FieldHeader({ displayName, phase, locked }: IHeaderParams & { phase: number; locked: boolean }) {
  return (
    <span className="field-header">
      <span className="field-header-name">{displayName}</span>
      {locked && <span className="field-header-note">from GitHub</span>}
      {phase > 1 && <span className="field-header-note">Arrives in phase {phase}</span>}
    </span>
  );
}

/** The columns every view shows and keeps on the left, so a row always says which initiative it is. */
export const CORE_COLUMNS = ["stack_rank", "item_code", "initiative_name"] as const;

const WIDTH: Record<string, number> = {
  Select: 150, Text: 190, "Long text": 240, Number: 112, Currency: 120, Date: 116, "Date range": 170, Person: 190, "Person or text": 170,
  People: 190, Boolean: 96, Tags: 170, Links: 200, Relation: 150, Files: 170, Thread: 150, Structured: 170, Note: 150, System: 130, Computed: 124,
};
const WIDE: Record<string, number> = { initiative_name: 320, home_project: 160, stack_rank: 104, item_code: 116, project_rank: 124, health: 130, last_synced: 150, synced_with: 300, gh_project_status: 170 };

export type ColumnContext = {
  controller: PortfolioController;
  lookups: Lookups;
  today: () => Date;
  visible: ReadonlySet<string>;
  /** Shown columns in the order the view wants them (dragging a header changes it). */
  order: string[];
  /** Sorted by global rank (off while rows are grouped: the grouping decides the order). */
  sorted: boolean;
  /** Columns besides the core ones that stay on the left while the grid scrolls. */
  pinned?: ReadonlySet<string>;
};

export function buildColumns({ controller, lookups, today, visible, order, sorted, pinned }: ColumnContext): ColDef<GridItem>[] {
  const editable = () => controller.canEdit;
  const projectOptions: PickerOption[] = lookups.projects.map((p) => ({ value: p.id, label: p.name }));
  const personOptions: PickerOption[] = lookups.members.map((m) => ({ value: m.user_id, label: m.email }));
  const setter = (field: EditableField) => (p: { data: GridItem; newValue: unknown }) =>
    controller.edit(p.data.id, field, p.newValue == null ? "" : String(p.newValue)).ok;

  const display = (f: FieldDef, v: unknown): string => formatField(f, v, { today: today(), members: lookups.members, projects: lookups.projects });

  const def = (f: FieldDef): ColDef<GridItem> => {
    const reason = f.key === "stack_rank" ? null : readOnlyReason(f.key);
    const canEdit = reason === null && (f.key === "stack_rank" || EDITABLE_FIELDS.includes(f.key));
    const base: ColDef<GridItem> = {
      colId: f.key,
      field: f.key as never,
      headerName: f.name,
      headerComponent: FieldHeader,
      headerComponentParams: { phase: f.key === "project_rank" ? 1 : f.phase, locked: f.mode === "locked" || f.storage.startsWith("GitHub-synced") },
      headerTooltip: f.description ?? f.name,
      width: WIDE[f.key] ?? WIDTH[f.type] ?? 140,
      hide: !visible.has(f.key) && !(CORE_COLUMNS as readonly string[]).includes(f.key),
      sortable: false,
      suppressMovable: CORE_COLUMNS.includes(f.key as never),
      cellClass: [
        ["Number", "Currency", "Computed"].includes(f.type) && f.key !== "item_code" && f.key !== "synced_with" ? "num" : "",
        reason && f.key !== "item_code" ? "cell-locked" : "",
        f.key === "item_code" ? "mono muted" : "",
      ].filter(Boolean).join(" "),
      editable: canEdit ? editable : false,
      valueFormatter: (p) => display(f, p.value),
    };
    if (f.key === "stack_rank") {
      return {
        ...base, pinned: "left", sort: sorted ? "asc" : null, cellClass: "num cell-key-col", editable,
        valueFormatter: (p) => `#${p.value}`,
        valueSetter: (p) => {
          controller.editRank(p.data.id, String(p.newValue ?? "").replace(/^#/, ""));
          return false; // the controller updated the rows; the grid refreshes from its change events
        },
      };
    }
    if (CORE_COLUMNS.includes(f.key as never)) base.pinned = "left";
    if (f.key === "initiative_name") { base.flex = 1; base.minWidth = 300; base.cellClass = `${String(base.cellClass ?? "")} cell-name`.trim(); }
    if (f.key === "item_code") {
      return {
        ...base, cellClass: "mono muted cell-open", headerTooltip: "Click a code to open the item panel", tooltipValueGetter: () => "Open the item panel (Space on any cell does the same)",
        // the linked tracker issue sits next to the code and opens the ticket in a new tab
        cellRenderer: (p: { value: unknown; data?: GridItem }) => {
          const link = p.data ? lookups.github?.links[p.data.id] : undefined;
          const label = link ? trackerIssueLabel(link.url, link.number) : null;
          return (
            <>
              {String(p.value ?? "")}
              {label && isOpenableUrl(link?.url) && (
                <a className="issue-link" href={link.url!} target="_blank" rel="noreferrer noopener" aria-label={`Open issue ${label} in a new tab`} title="Open the ticket in a new tab">{label}</a>
              )}
            </>
          );
        },
      };
    }
    if (f.key === "project_rank") return base;
    if (f.key === "health") return { ...base, cellRenderer: HealthCell, ...pickerDef(f, optionsFor(f.key), true) };
    if (reason) {
      return { ...base, cellRenderer: (p: { value: unknown }) => <ReadOnlyCell text={display(f, p.value) || (f.key === "status" ? "Not on GitHub" : f.key === "gh_project_status" ? "Not on a board" : f.key === "last_synced" || f.key === "synced_with" ? "Not synced" : "")} reason={reason} github={f.mode === "locked" || f.storage.startsWith("GitHub-synced")} /> };
    }
    if (!canEdit) return base;
    base.valueSetter = setter(f.key) as never;
    if (f.key === "home_project") return { ...base, cellRenderer: (p: { value: unknown }) => (p.value ? <span className="proj-pill">{display(f, p.value)}</span> : null), ...pickerDef(f, projectOptions, false) };
    if (f.type === "Person") return { ...base, ...pickerDef(f, personOptions, true, "Unassigned") };
    if (f.type === "Boolean") {
      return {
        ...base,
        valueGetter: (p) => (p.data?.[f.key] == null ? "" : p.data[f.key] ? "Yes" : "No"),
        valueFormatter: (p) => String(p.value ?? ""),
        ...pickerDef(f, optionsFor(f.key), false),
      };
    }
    if (f.key === "theme") {
      // an open list: the picker offers the workspace's groups and lets you type a new one
      return {
        ...base,
        editable: reasonFree(f) ? editable : false,
        cellEditor: PickerEditor,
        cellEditorPopup: true,
        cellEditorParams: () => ({ options: controller.groupNames().map((g) => ({ value: g, label: g })), allowEmpty: true, emptyLabel: "No group", allowCreate: true }),
        valueSetter: setter(f.key) as never,
      };
    }
    if (f.type === "Select" && f.allowed.length > 0) return { ...base, ...pickerDef(f, optionsFor(f.key), true) };
    if (f.type === "Date") { base.cellEditor = DateEditor; base.cellEditorPopup = true; }
    else if (f.type === "Currency" || f.type === "Number") base.cellEditorParams = { useFormatter: true };
    return base;
  };

  function pickerDef(f: FieldDef, options: PickerOption[], allowEmpty: boolean, emptyLabel?: string): Partial<ColDef<GridItem>> {
    return {
      editable: reasonFree(f) ? editable : false,
      cellEditor: PickerEditor,
      cellEditorPopup: true,
      cellEditorParams: { options, allowEmpty, emptyLabel },
      valueSetter: setter(f.key) as never,
    };
  }
  const reasonFree = (f: FieldDef) => readOnlyReason(f.key) === null;

  // the left side reads like the prototype: global rank, rank in project, ID, initiative
  const FIRST = ["stack_rank", "project_rank", "item_code", "initiative_name"];
  const pos = new Map(order.map((k, i) => [k, i]));
  const registry = new Map(FIELDS.map((f, i) => [f.key, i]));
  const rank = (d: ColDef<GridItem>) => {
    const k = String(d.colId);
    const first = FIRST.indexOf(k);
    return first >= 0 ? first : FIRST.length + (pos.get(k) ?? 1000 + (registry.get(k) ?? 0));
  };
  const pin = (c: ColDef<GridItem>): ColDef<GridItem> => (pinned?.has(String(c.colId)) ? { ...c, pinned: "left", suppressMovable: true } : c);
  // Description is Markdown: one plain line in the cell, the rendered text on hover
  const withMarkdown = (c: ColDef<GridItem>): ColDef<GridItem> =>
    c.colId === "description"
      ? { ...c, valueFormatter: (p) => markdownToPlainText(String(p.value ?? "")),
        // an empty title stops the browser adding its own plain-text hover on top of the rendered one
        cellRenderer: (p: { valueFormatted?: string | null }) => <span className="cell-text" title="">{p.valueFormatted ?? ""}</span>,
        tooltipValueGetter: (p) => String(p.value ?? ""), tooltipComponent: MarkdownTooltip }
      : c;
  return FIELDS.map(def).map(withMarkdown).map(pin).sort((a, b) => rank(a) - rank(b));
}

/** Column ids whose cells cannot be edited, with the reason (for the notice under the grid). */
export const isReadOnlyColumn = (colId: string) => colId !== "stack_rank" && readOnlyReason(colId) !== null;
export const isEditableColumn = (colId: string) => EDITABLE_FIELDS.includes(colId);
export { isShipped };
