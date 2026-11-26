"use client";

import { emptyTrackerText, rowTracker, trackerWords } from "./tracker-words";
import { FlagControl, actionClass } from "@/components/flag-controls";
import { NameWithIssues } from "./name-cell";
import type { ColDef, IHeaderParams } from "ag-grid-community";
import type { CustomCellRendererProps } from "ag-grid-react";
import {
  EDITABLE_FIELDS, FIELD_BY_KEY, VISIBLE_FIELDS, cardFieldOffer, actionsOfFlags, openGateOf, resolveFlagAction, type OutcomeReview, changeTone, compareQuarters, flagsOfRow, jiraCategoryTone, isOpenList, isOpenableUrl, isQuarter, quarterMismatch, isShipped, optionsFor, readOnlyReason, trackerIssueLabel,
  type EditableField, type FieldDef,
} from "@pv/domain";
import type { PortfolioController } from "./controller";
import { formatField } from "./format";
import { markdownToPlainText } from "./markdown-text";
import { MarkdownTooltip } from "./markdown-tooltip";
import { DateEditor } from "./date-editor";
import { PickerEditor, type PickerOption } from "./picker-editor";
import type { GridItem, Lookups } from "./types";
import { EffortPill, MoscowPill, PersonChip, ProgressMeter, SizeDot } from "../../components/field-visuals";
import { StatusPill } from "../../components/status-pill";
import { PILL_FIELDS, statusTone, toneFor } from "../../components/status-tone";
import { peopleOf, personOptions } from "./people";

/** A compact pill with the word and no icon: the label is the signal, colour is only an extra (never colour alone). */
function HealthCell({ value }: { value: string | null }) {
  if (!value) return null;
  return <StatusPill value={value} tone={statusTone(value)} />;
}

function ReadOnlyCell({ text, reason, pill, field, children }: { text: string; reason: string | null; /** Kept so callers say whether the column is tracker-driven; the lock is drawn once in the column header, not in every row. */ github?: boolean; pill?: boolean; field?: string; children?: React.ReactNode }) {
  return (
    <span className="lock-cell" title={reason ?? undefined}>
      {children ?? (pill && text ? <StatusPill value={text} tone={toneFor(field ?? "", text)} /> : text)}
    </span>
  );
}

/** What the grid hands every cell (the AG Grid `context`): the Actions column asks it to act, and which button is working. */
export type GridContext = { runFlagAction?: (itemId: string, flagKind: string) => void; flagBusy?: string | null; /** The 30, 60 and 90 day outcome reviews, when loaded: the flag for them needs to know which are asked for or recorded. */ outcomeReviews?: readonly OutcomeReview[] };

/**
 * The Flags column: every flag of the row as a pill with its words (the full reason is the tooltip). Several flags sit side by side; the column scrolls nothing, so it is wide.
 * A pill whose flag has an action does what that action's button does when clicked (move now, open the gate request, or go to Decisions once the gate is requested).
 */
function FlagsCell({ data, today, canAct, context }: CustomCellRendererProps<GridItem> & { today: () => Date; canAct: boolean }) {
  if (!data) return null;
  const ctx = (context ?? {}) as GridContext;
  const flags = flagsOfRow(data, today(), { ...(ctx.outcomeReviews ? { outcomeReviews: ctx.outcomeReviews } : {}) });
  if (flags.length === 0) return null;
  const labels = [...new Set(flags.map((f) => f.label))]; // several reasons can share a label (Delivery risk): one pill, every reason in the tooltip
  const openGate = openGateOf(data);
  return (
    <span className="grid-flags" title={flags.map((f) => `${f.label}: ${f.text}`).join("\n")}>
      {labels.map((l) => {
        const flag = canAct ? flags.find((f) => f.label === l && f.action) : undefined;
        const resolved = flag?.action ? resolveFlagAction(flag.action, data.initiative_phase, openGate) : null;
        const text = <>{"\u2691"} {l}</>;
        if (!flag || !resolved) return <span key={l} className="pill tone-risk chg-flag">{text}</span>;
        return <FlagControl key={l} a={resolved} className="pill tone-risk chg-flag chg-flag-act" busy={ctx.flagBusy === `${data.id}:${flag.kind}`} onRun={() => ctx.runFlagAction?.(data.id, flag.kind)}>{text}</FlagControl>;
      })}
    </span>
  );
}

/** The Actions column: the next step of each flag as a button. A move that passes no gate is made at once; one that passes a gate opens the gate request. Viewers see none. */
function ActionsCell({ data, today, canAct, context }: CustomCellRendererProps<GridItem> & { today: () => Date; canAct: boolean }) {
  if (!data) return null;
  const ctx = (context ?? {}) as GridContext;
  const actions = actionsOfFlags(flagsOfRow(data, today(), { ...(ctx.outcomeReviews ? { outcomeReviews: ctx.outcomeReviews } : {}) }), data.initiative_phase, canAct, openGateOf(data));
  if (actions.length === 0) return null;
  return (
    <span className="grid-flags">
      {actions.map(({ flag, resolved }) => {
        const key = `${data.id}:${flag.kind}`;
        return (
          <FlagControl key={flag.kind} a={resolved} className={actionClass(resolved)} busy={ctx.flagBusy === key} onRun={() => ctx.runFlagAction?.(data.id, flag.kind)}>
            {ctx.flagBusy === key ? "Working\u2026" : <>{resolved.label}<span className="chg-act-arrow" aria-hidden="true"> {"\u2192"}</span></>}
          </FlagControl>
        );
      })}
    </span>
  );
}

/** The read-only fields both trackers fill (Build Status follows the Jira status category too). */

/** Column header: the field name, plus a words-only note when the field is read-only or from a later phase. */
function FieldHeader({ displayName, phase, locked, from }: IHeaderParams & { phase: number; locked: boolean; from: string }) {
  return (
    <span className="field-header">
      <span className="field-header-name">{displayName}</span>
      {locked && (
        <span className="field-header-note" title={`Read only: ${from}`}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" role="img" aria-label="Read only" style={{ marginRight: 4, verticalAlign: "-1px" }}>
            <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          {from}
        </span>
      )}
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
const WIDE: Record<string, number> = { outcome_review_date: 160, outcome_reviews_recorded: 190, realized_kr_value: 160, kr_realized_pct: 170, outcome_latest_adoption: 170, outcome_kr_progress: 210, initiative_name: 320, home_project: 160, stack_rank: 104, item_code: 116, project_rank: 124, health: 118, moscow: 108, effort: 112, roadmap_category: 190, last_synced: 150, synced_with: 300, tracker_ownership: 170, gh_project_status: 170, tracker_status: 170 };

export type ColumnContext = {
  controller: PortfolioController;
  lookups: Lookups;
  today: () => Date;
  visible: ReadonlySet<string>;
  /** Shown columns in the order the view wants them (dragging a header changes it). */
  order: string[];
  /** Sorted by global rank (off while rows are grouped: the grouping decides the order). */
  sorted: boolean;
  /** The locked columns (any, up to four): they stay on the left while the grid scrolls right. */
  pinned?: ReadonlySet<string>;
  /** "Show issues" is on: the Initiative Name cell carries the chip that folds its issues. */
  showIssues?: boolean;
  /** The scope is one project: the Project column says the same on every row, so it is plain text, not a chip. */
  singleProject?: boolean;
  /** Widths the person dragged, saved with the view (pixels by field key). */
  widths?: Record<string, number>;
};

export function buildColumns({ controller, lookups, today, visible, order, sorted, pinned, showIssues, singleProject, widths }: ColumnContext): ColDef<GridItem>[] {
  const editable = () => controller.canEdit;
  const projectOptions: PickerOption[] = lookups.projects.map((p) => ({ value: p.id, label: p.name }));
  const setter = (field: EditableField) => (p: { data: GridItem; newValue: unknown }) =>
    controller.edit(p.data.id, field, p.newValue == null ? "" : String(p.newValue)).ok;

  const display = (f: FieldDef, v: unknown): string => formatField(f, v, { today: today(), people: peopleOf(lookups), projects: lookups.projects });

  const def = (f: FieldDef): ColDef<GridItem> => {
    const reason = f.key === "stack_rank" ? null : readOnlyReason(f.key);
    const canEdit = reason === null && (f.key === "stack_rank" || EDITABLE_FIELDS.includes(f.key));
    const base: ColDef<GridItem> = {
      colId: f.key,
      field: f.key as never,
      headerName: f.name,
      headerComponent: FieldHeader,
      headerComponentParams: { phase: isShipped(f) || f.mode === "locked" || f.storage.startsWith("GitHub-synced") ? 1 : f.phase, locked: f.mode === "locked" || f.storage.startsWith("GitHub-synced"), from: f.key === "gh_project_status" ? "GitHub only" : `from ${trackerWords(lookups)}` },
      headerTooltip: f.description ?? f.name,
      width: widths?.[f.key] ?? WIDE[f.key] ?? WIDTH[f.type] ?? 140,
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
        ...base, sort: sorted ? "asc" : null, cellClass: "num cell-key-col", editable,
        valueFormatter: (p) => `#${p.value}`,
        // the same small grey badge as the card header, without the "#" (the editor and the export still use the number)
        cellRenderer: (p: { value: unknown }) => <span className="rank-badge" title={`Stack rank ${String(p.value ?? "")}`}><span className="visually-hidden">Stack rank </span>{String(p.value ?? "")}</span>,
        valueSetter: (p) => {
          controller.editRank(p.data.id, String(p.newValue ?? "").replace(/^#/, ""));
          return false; // the controller updated the rows; the grid refreshes from its change events
        },
      };
    }
    if (f.key === "initiative_name") {
      // the name takes the space that is left, until someone drags it to a width of their own
      if (widths?.[f.key] === undefined) base.flex = 1;
      base.minWidth = widths?.[f.key] === undefined ? 300 : 120; base.cellClass = `${String(base.cellClass ?? "")} cell-name`.trim();
      if (showIssues) base.cellRenderer = NameWithIssues;
    }
    if (f.key === "item_code") {
      return {
        ...base, cellClass: "mono muted cell-open", headerTooltip: "Click a code to open the item panel", tooltipValueGetter: () => "Open the item panel (Space on any cell does the same)",
        // the linked tracker issue sits next to the code and opens the ticket in a new tab
        cellRenderer: (p: { value: unknown; data?: GridItem }) => {
          const link = p.data ? lookups.github?.links[p.data.id] : undefined;
          const jira = p.data && !link ? lookups.jira?.links[p.data.id] : undefined;
          const label = link ? trackerIssueLabel(link.url, link.number) : jira?.issueKey ?? null;
          const url = link ? link.url : jira?.url ?? null;
          return (
            <>
              {String(p.value ?? "")}
              {label && isOpenableUrl(url) && (
                <a className="issue-link" href={url} target="_blank" rel="noreferrer noopener" aria-label={`Open issue ${label} in a new tab`} title="Open the ticket in a new tab">{label}</a>
              )}
            </>
          );
        },
      };
    }
    if (f.key === "project_rank") return { ...base, cellClass: "num rank-muted" };
    if (f.key === "tracker_status") {
      // the tracker's own words, coloured by what the mapping makes of them: a Jira status by its category (the one Build Status follows), a GitHub state by open or closed
      return { ...base, cellRenderer: (p: CustomCellRendererProps<GridItem>) => {
        const v = typeof p.value === "string" ? p.value : "";
        const jira = p.data ? lookups.jira?.links[p.data.id] : undefined;
        // an initiative with only epics read from Jira (read-only project) has no issue status: its pill is coloured by what the epics add up to
        const epicCategory = (p.data as unknown as Record<string, unknown> | undefined)?.tracker_status_category;
        const tone = jira ? jiraCategoryTone(jira.category) : epicCategory === "new" || epicCategory === "indeterminate" || epicCategory === "done" ? jiraCategoryTone(epicCategory) : changeTone("issue-status", v, "GitHub");
        return <ReadOnlyCell text="" reason={reason} github={false}>{v ? <StatusPill value={v} tone={tone} /> : <span className="muted">Not linked</span>}</ReadOnlyCell>;
      } };
    }
    if (f.key === "flags") return { ...base, suppressNavigable: true, width: widths?.flags ?? 360, valueFormatter: (p) => String(p.value ?? ""), cellRenderer: (p: CustomCellRendererProps<GridItem>) => <FlagsCell {...p} today={today} canAct={controller.canEdit} />, cellClass: "cell-locked" };
    if (f.key === "actions") return { ...base, suppressNavigable: true, width: widths?.actions ?? 340, valueFormatter: (p) => String(p.value ?? ""), cellRenderer: (p: CustomCellRendererProps<GridItem>) => <ActionsCell {...p} today={today} canAct={controller.canEdit} />, cellClass: "cell-locked" };
    if (f.key === "health") return { ...base, cellRenderer: HealthCell, ...pickerDef(f, optionsFor(f.key), true) };
    if (reason) {
      return { ...base, cellRenderer: (p: CustomCellRendererProps<GridItem>) => <ReadOnlyCell text={display(f, p.value) || (emptyTrackerText(f.key, p.data ? rowTracker(lookups, p.data) : null) ?? (f.key === "tracker_status" ? "Not linked" : f.key === "last_synced" || f.key === "synced_with" ? "Not synced" : f.key === "tracker_ownership" ? "Not linked" : ""))} reason={reason} pill={PILL_FIELDS.has(f.key)} field={f.key} github={f.mode === "locked" || f.storage.startsWith("GitHub-synced")} /> };
    }
    if (!canEdit) return base;
    base.valueSetter = setter(f.key) as never;
    if (f.key === "home_project") return { ...base, cellRenderer: (p: { value: unknown }) => (p.value ? <span className={singleProject ? "proj-plain" : "proj-pill"}>{display(f, p.value)}</span> : null), ...pickerDef(f, projectOptions, false) };
    if (f.type === "Person") {
      // the list is read when the picker opens, so someone added a moment ago is on it; a typed name that is not on it adds a person (nothing is sent to them)
      return {
        ...base,
        editable: reasonFree(f) ? editable : false,
        cellEditor: PickerEditor,
        cellEditorPopup: true,
        cellEditorParams: () => ({ options: personOptions(lookups), allowEmpty: true, emptyLabel: "Unassigned", allowCreate: true, createLabel: (t: string) => `Add “${t}” to the people list` }),
        valueSetter: ((p: { data: GridItem; newValue: unknown }) => controller.editPerson(p.data.id, f.key as EditableField, p.newValue == null ? "" : String(p.newValue)).ok) as never,
      };
    }
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
    if (isOpenList(f.key)) {
      // an open list (Focus Area, Audience): the picker offers the values already in use and lets you type a new one
      return {
        ...base,
        editable: reasonFree(f) ? editable : false,
        cellEditor: PickerEditor,
        cellEditorPopup: true,
        cellEditorParams: () => ({ options: controller.openValues(f.key).map((v) => ({ value: v, label: v })), allowEmpty: true, emptyLabel: "Not set", allowCreate: true }),
        valueSetter: setter(f.key) as never,
      };
    }
    if (f.key === "g2m_quarter") {
      // Planned Quarter: the generated quarters plus every quarter already used, so one that left the range stays selectable
      return {
        ...base,
        // a G2M Date (est) outside the quarter is a hint, never a change (FR-5): a warning sign after the quarter, explained in the tooltip
        valueFormatter: (p) => `${String(p.value ?? "")}${p.data && quarterMismatch(p.data.g2m_quarter, p.data.g2m_date_est) ? " \u26A0" : ""}`,
        tooltipValueGetter: (p) => (p.data && quarterMismatch(p.data.g2m_quarter, p.data.g2m_date_est) ? "G2M date is outside the planned quarter" : (f.description ?? f.name)),
        comparator: (a: unknown, b: unknown) => (isQuarter(a) && isQuarter(b) ? compareQuarters(a, b) : String(a ?? "").localeCompare(String(b ?? ""))), ...pickerDef(f, [], true, "Unscheduled"), cellEditorParams: () => ({ options: optionsFor(f.key, controller.rows.map((r) => r.g2m_quarter)), allowEmpty: true, emptyLabel: "Unscheduled" }),
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
  const registry = new Map(VISIBLE_FIELDS.map((f, i) => [f.key, i]));
  const rank = (d: ColDef<GridItem>) => {
    const k = String(d.colId);
    const first = FIRST.indexOf(k);
    return first >= 0 ? first : FIRST.length + (pos.get(k) ?? 1000 + (registry.get(k) ?? 0));
  };
  const pin = (c: ColDef<GridItem>): ColDef<GridItem> => (pinned?.has(String(c.colId)) ? { ...c, pinned: "left", suppressMovable: true } : c);
  // Description and Summary are Markdown: one plain line in the cell, the rendered text on hover
  const withMarkdown = (c: ColDef<GridItem>): ColDef<GridItem> =>
    c.colId === "description" || c.colId === "summary"
      ? { ...c, valueFormatter: (p) => markdownToPlainText(String(p.value ?? "")),
        // the text fades out instead of ending in "...": the browser adds its own plain-text hover to text cut off by an ellipsis, on top of the rendered one
        cellRenderer: (p: { valueFormatted?: string | null }) => <span className="cell-text cell-text-fade" title="">{p.valueFormatted ?? ""}</span>,
        tooltipValueGetter: (p) => String(p.value ?? ""), tooltipComponent: MarkdownTooltip }
      : c;
  // single-status fields read as pills (words always shown); read-only ones are drawn by ReadOnlyCell
  const withPill = (c: ColDef<GridItem>): ColDef<GridItem> =>
    PILL_FIELDS.has(String(c.colId)) && !readOnlyReason(String(c.colId))
      ? { ...c, cellRenderer: (p: { valueFormatted?: string | null }) => <StatusPill value={p.valueFormatted ?? ""} tone={toneFor(String(c.colId), p.valueFormatted ?? "")} /> }
      : c;
  // the same drawings as the card, by type (decision 2026-11-22-grid-matches-cards.md). Dates stay in the account's date format.
  const withVisual = (c: ColDef<GridItem>): ColDef<GridItem> => {
    const key = String(c.colId);
    const f = FIELD_BY_KEY[key];
    if (!f) return c;
    const reason = key === "stack_rank" ? null : readOnlyReason(key);
    const lock = (node: React.ReactNode, text: string) => <ReadOnlyCell text={text} reason={reason} github={f.mode === "locked" || f.storage.startsWith("GitHub-synced")}>{node}</ReadOnlyCell>;
    const wrap = (node: React.ReactNode, text: string) => (reason ? lock(node, text) : node);
    if (key === "moscow") return { ...c, cellRenderer: (p: { value: unknown }) => { const t = String(p.value ?? ""); return t ? wrap(<MoscowPill value={t} name={f.name} />, t) : null; } };
    if (key === "g2m_effort") return { ...c, cellRenderer: (p: { value: unknown }) => { const t = String(p.value ?? ""); return t ? wrap(<EffortPill value={t} name={f.name} />, t) : null; } };
    if (key === "effort") return { ...c, cellRenderer: (p: { value: unknown }) => { const t = String(p.value ?? ""); return t ? wrap(<SizeDot value={t} name={f.name} />, t) : null; } };
    if (cardFieldOffer(key).ok && (cardFieldOffer(key) as { render: string }).render === "progress") {
      return { ...c, cellRenderer: (p: { value: unknown; valueFormatted?: string | null }) => {
        const shown = p.valueFormatted ?? String(p.value ?? "");
        const bar = <ProgressMeter value={p.value} name={f.name} />;
        return shown ? wrap(bar ?? shown, shown) : null;
      } };
    }
    if (f.type === "Person" && key !== "created_by") {
      return { ...c, cellRenderer: (p: { value: unknown; valueFormatted?: string | null }) => { const t = p.valueFormatted ?? ""; return t ? wrap(<PersonChip text={t} name={f.name} />, t) : null; } };
    }
    return c;
  };
  // a cut-off text says its full value on hover (pills and chips carry their own title)
  const withTip = (c: ColDef<GridItem>): ColDef<GridItem> => (c.tooltipValueGetter || c.cellRenderer || !["Select", "Text"].includes(FIELD_BY_KEY[String(c.colId)]?.type ?? "") ? c : { ...c, tooltipValueGetter: (p) => (typeof p.valueFormatted === "string" && p.valueFormatted.length > 14 ? p.valueFormatted : undefined) });
  return VISIBLE_FIELDS.map(def).map(withPill).map(withVisual).map(withTip).map(withMarkdown).map(pin).sort((a, b) => rank(a) - rank(b));
}

/** Column ids whose cells cannot be edited, with the reason (for the notice under the grid). */
export const isReadOnlyColumn = (colId: string) => colId !== "stack_rank" && readOnlyReason(colId) !== null;
export const isEditableColumn = (colId: string) => EDITABLE_FIELDS.includes(colId);
export { isShipped };
