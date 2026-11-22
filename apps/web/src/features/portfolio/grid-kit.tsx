"use client";

import { CellStyleModule, ClientSideRowModelModule, ColumnApiModule, ModuleRegistry, RenderApiModule, RowApiModule, RowSelectionModule, RowStyleModule, ScrollApiModule, TooltipModule, _SortModule, themeQuartz } from "ag-grid-community";
import type { CustomCellRendererProps } from "ag-grid-react";
import type { GroupRow } from "@pv/domain";

/**
 * What every grid in Product Velocity shares with the Roadmap grid (issue #472, Ashu 2026-11-17: "use the main grid we already have as the basis"):
 * the AG Grid modules, the compact look (theme), the default column behaviour, and the group header row. The Roadmap grid and the Changes report both use these,
 * so a change to the look or to the header of a group is made once. Row grouping itself is Enterprise only (spike S1): groups are header rows we build
 * (`buildGroupedRows` in the domain package) and this renderer draws.
 */
ModuleRegistry.registerModules([ClientSideRowModelModule, CellStyleModule, RowStyleModule, TooltipModule, ColumnApiModule, RowSelectionModule, _SortModule, RowApiModule, ScrollApiModule, RenderApiModule]);

export const GRID_THEME = themeQuartz.withParams({
  fontFamily: "IBM Plex Sans, system-ui, sans-serif",
  fontSize: 13,
  headerFontSize: 12,
  headerFontWeight: 600,
  headerTextColor: "#374151",
  columnBorder: false,
  headerColumnBorder: false,
  rowBorder: { style: "solid", width: 1, color: "#F3F4F7" },
  selectedRowBackgroundColor: "#f3f8fe",
  rowHeight: 36,
  headerHeight: 28,
  accentColor: "#2270ed",
  borderColor: "#E6E9EF",
  headerBackgroundColor: "#F8F9FC",
  wrapperBorderRadius: 8,
  spacing: 6,
});

export const DEFAULT_COL_DEF = { sortable: false, resizable: true, cellDataType: false } as const;

export const isGroup = (r: unknown): r is GroupRow => !!r && typeof r === "object" && (r as { __group?: boolean }).__group === true;

/**
 * Full-width header row of a group: a toggle, the group's name and how many rows it holds, then the health in words (Roadmap) or badges with their words
 * (other screens). A "Then by" header sits indented inside its group. The grid's `context` must offer `toggleGroup(key)`.
 */
export function GroupRowRenderer(p: CustomCellRendererProps<GroupRow>) {
  const g = p.data;
  if (!g) return null;
  const toggle = (p.context as { toggleGroup: (key: string) => void }).toggleGroup;
  return (
    <div className="group-row" role="gridcell" data-level={g.level ?? 0}>
      <button type="button" className="group-toggle" aria-expanded={!g.collapsed} aria-label={`${g.collapsed ? "Expand" : "Collapse"} group ${g.label}`} onClick={() => toggle(g.key)}>
        {g.collapsed ? "▸" : "▾"}
      </button>
      <span>{g.label}</span>
      <span className="group-count">{g.count} {g.unit ?? (g.count === 1 ? "item" : "items")}</span>
      {g.healthSummary && <span className="group-health">{g.healthSummary}</span>}
      {g.badges?.map((b) => <span key={b.text} className={`pill tone-${b.tone}`} title={b.title}>{b.text}</span>)}
    </div>
  );
}
