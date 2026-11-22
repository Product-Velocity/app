"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import { CsvExportModule, ModuleRegistry, type ColDef, type ColumnMovedEvent, type GridApi } from "ag-grid-community";
import { DEFAULT_COL_DEF, GRID_THEME, GroupRowRenderer } from "@/features/portfolio/grid-kit";
import { formatWhen } from "@/lib/audit-log";
import { agentsText, companyHost, csvSafe, isPaused, safeUrl, statusLabel, totals, trackerText, type AccountRow, type MemberRow } from "./accounts-model";
import { AccountFilterChips, AccountsBar } from "./accounts-bar";
import { NO_FILTERS, filterAccounts, groupAccountRows, isHeader, type AccountFilters, type AccountGridRow, type GroupBy } from "./accounts-view";
import { enterAccount } from "./actions";
import { AccountDrawer } from "./account-drawer";

// The All accounts console on the same default grid as the Roadmap and the Changes report: the action bar (Filter, Columns, Group by, fold all, Search),
// the compact AG Grid look and the shared group header rows. Row double-click or "Manage" opens the account drawer (details, actions, people).
ModuleRegistry.registerModules([CsvExportModule]);

type Ctx = { open: (id: string) => void };
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const num = (n: number) => n.toLocaleString("en-GB");

const AccountCell = (p: CustomCellRendererProps<AccountGridRow>) => {
  const r = p.data as AccountRow;
  return (
    <span className="acct-name">
      <button type="button" className="link-button" onClick={() => (p.context as Ctx).open(r.tenant_id)} title={`Open ${r.name}`}><strong>{r.name}</strong></button>
      {isPaused(r) && <span className="pill tone-risk" title="Members cannot open this account">Paused</span>}
    </span>
  );
};
const UrlCell = (p: CustomCellRendererProps<AccountGridRow>) => {
  const d = p.data as AccountRow;
  const href = safeUrl(d.company_url);
  const host = companyHost(d.company_url);
  if (!href || !host) return <span className="muted">—</span>;
  return <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`Open ${host} (new tab)`}>{host} ↗</a>;
};
const OwnerCell = (p: CustomCellRendererProps<AccountGridRow>) => {
  const r = p.data as AccountRow;
  return r.owner_email ? <span title={r.owner_email}>{r.owner_name ? <>{r.owner_name} <span className="muted">{r.owner_email}</span></> : r.owner_email}</span> : <span className="muted">—</span>;
};
const AgentsCell = (p: CustomCellRendererProps<AccountGridRow>) => {
  const r = p.data as AccountRow;
  if (r.ai_agents.length === 0) return <span className="muted">{agentsText(r)}</span>;
  return (
    <span className="acct-agents" title={r.ai_agents.map((a) => `${a.name}: ${a.connections} connection${a.connections === 1 ? "" : "s"}, ${num(a.calls)} calls${a.last_used_at ? `, last used ${day(a.last_used_at)}` : ""}`).join("\n")}>
      {r.ai_agents.map((a) => <span key={a.name} className="pill tone-info">{a.name}{a.connections > 1 ? ` ×${a.connections}` : ""}</span>)}
    </span>
  );
};
const TrackerCell = (p: CustomCellRendererProps<AccountGridRow>) => {
  const s = p.value as string | null;
  return <span className={s === "connected" ? "" : "muted"}>{trackerText(s)}</span>;
};
const ActionsCell = (p: CustomCellRendererProps<AccountGridRow>) => {
  const r = p.data as AccountRow;
  return (
    <span className="acct-actions">
      <form action={enterAccount}>
        <input type="hidden" name="tenant" value={r.tenant_id} />
        <button className="btn btn-primary btn-sm" type="submit" data-testid="enter-account" aria-label={`Enter ${r.name}`}>Enter</button>
      </form>
      <button className="btn btn-sm" type="button" data-testid="manage-account" aria-label={`Manage ${r.name}`} onClick={() => (p.context as Ctx).open(r.tenant_id)}>Manage</button>
    </span>
  );
};

const numCol = { type: "rightAligned", cellClass: "ag-right-aligned-cell" } as const;

const COLUMNS: { id: string; label: string; hidden?: boolean; def: ColDef<AccountRow> }[] = [
  { id: "name", label: "Account", def: { headerName: "Account", pinned: "left", width: 230, cellRenderer: AccountCell, valueGetter: (p) => p.data?.name } },
  { id: "company_url", label: "Company URL", def: { headerName: "Company URL", width: 190, cellRenderer: UrlCell, valueGetter: (p) => p.data?.company_url ?? "" } },
  { id: "status", label: "Status", def: { headerName: "Status", width: 100, valueGetter: (p) => (p.data ? statusLabel(p.data) : "") } },
  { id: "plan", label: "Plan", def: { headerName: "Plan", width: 100, field: "plan" } },
  { id: "owner", label: "Owner", def: { headerName: "Owner", width: 260, cellRenderer: OwnerCell, valueGetter: (p) => [p.data?.owner_name, p.data?.owner_email].filter(Boolean).join(" ") } },
  { id: "created_at", label: "Created", def: { headerName: "Created", width: 120, valueGetter: (p) => day(p.data?.created_at ?? null),  } },
  { id: "member_count", label: "Members", def: { headerName: "Members", width: 105, field: "member_count", ...numCol } },
  { id: "invited_count", label: "Pending invites", def: { headerName: "Pending invites", width: 130, field: "invited_count", ...numCol } },
  { id: "requested_count", label: "Access requests", def: { headerName: "Access requests", width: 135, field: "requested_count", ...numCol } },
  { id: "project_count", label: "Projects", def: { headerName: "Projects", width: 100, field: "project_count", ...numCol } },
  { id: "item_count", label: "Line items", def: { headerName: "Line items", width: 110, field: "item_count", ...numCol } },
  { id: "last_activity", label: "Last activity", def: { headerName: "Last activity", width: 190, valueGetter: (p) => day(p.data?.last_activity ?? null), valueFormatter: (p) => (p.data?.last_activity ? formatWhen(p.data.last_activity, "UTC", false) : "No activity yet"),  } },
  { id: "last_login_at", label: "Last login", def: { headerName: "Last login", width: 190, valueGetter: (p) => day(p.data?.last_login_at ?? null), valueFormatter: (p) => (p.data?.last_login_at ? formatWhen(p.data.last_login_at, "UTC", false) : "Never"),  } },
  { id: "ai_agents", label: "AI agents", def: { headerName: "AI agents", width: 250, cellRenderer: AgentsCell, valueGetter: (p) => (p.data ? agentsText(p.data) : "") } },
  { id: "github_state", label: "GitHub", def: { headerName: "GitHub", width: 130, cellRenderer: TrackerCell, field: "github_state" } },
  { id: "jira_state", label: "Jira", def: { headerName: "Jira", width: 130, cellRenderer: TrackerCell, field: "jira_state" } },
  { id: "access", label: "Platform access", def: { headerName: "Platform access", width: 150, valueGetter: (p) => (p.data?.access_override ? "Read-only" : "Default") } },
  { id: "country", label: "Country", hidden: true, def: { headerName: "Country", width: 120, valueGetter: (p) => p.data?.country ?? "" } },
  { id: "actions", label: "Actions", def: { headerName: "", width: 170, pinned: "right", sortable: false, cellRenderer: ActionsCell, suppressHeaderMenuButton: true } },
];
const MOVABLE = COLUMNS.filter((c) => c.id !== "name" && c.id !== "actions");
const DEFAULT_COLUMNS = MOVABLE.filter((c) => !c.hidden).map((c) => c.id);
const STORE = "pv.platform.accounts.view";
type Saved = { columns: string[]; by: GroupBy | null; then: GroupBy | null };
const DEFAULT_SAVED: Saved = { columns: DEFAULT_COLUMNS, by: null, then: null };
// the chosen columns and grouping live in this browser only (a convenience; the server cannot know them)
const readSaved = (): Saved => {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "null") as Partial<Saved> | null;
    if (v && Array.isArray(v.columns)) {
      const cols = v.columns.filter((id): id is string => MOVABLE.some((c) => c.id === id));
      if (cols.length > 0) return { columns: cols, by: v.by ?? null, then: v.by ? (v.then ?? null) : null };
    }
  } catch { /* private window */ }
  return DEFAULT_SAVED;
};
const getRowId = (p: { data: AccountGridRow }) => (isHeader(p.data) ? p.data.id : p.data.tenant_id);
const isFullWidthRow = (p: { rowNode: { data?: unknown } }) => isHeader(p.rowNode.data);

/** `fixtureMembers` is for the e2e harness only (/dev/accounts): the drawer shows these people instead of asking the server. */
export function AccountsGrid({ rows, emailEnabled, fixtureMembers }: { rows: AccountRow[]; emailEnabled: boolean; fixtureMembers?: MemberRow[] }) {
  const apiRef = useRef<GridApi<AccountGridRow> | null>(null);
  const [filters, setFilters] = useState<AccountFilters>(NO_FILTERS);
  const [saved, setSaved] = useState<Saved>(DEFAULT_SAVED);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setSaved(readSaved()); }, []);
  const change = (patch: Partial<Saved>) => setSaved((s) => {
    const next = { ...s, ...patch };
    try { localStorage.setItem(STORE, JSON.stringify(next)); } catch { /* optional */ }
    return next;
  });

  const filtered = useMemo(() => filterAccounts(rows, filters, now), [rows, filters, now]);
  const gridRows = useMemo(() => groupAccountRows(filtered, saved.by, saved.then, collapsed), [filtered, saved.by, saved.then, collapsed]);
  const groupKeys = useMemo(() => groupAccountRows(filtered, saved.by, saved.then, new Set()).filter(isHeader).map((h) => h.key), [filtered, saved.by, saved.then]);
  const sum = useMemo(() => totals(filtered), [filtered]);
  const toggle = useCallback((key: string) => setCollapsed((c) => { const n = new Set(c); if (!n.delete(key)) n.add(key); return n; }), []);
  const context = useMemo(() => ({ open: setOpenId, toggleGroup: toggle }), [toggle]);
  const columnDefs = useMemo<ColDef<AccountGridRow>[]>(() => {
    const byId = (id: string) => COLUMNS.find((c) => c.id === id)!;
    return ["name", ...saved.columns, "actions"].map((id) => ({ colId: id, sortable: false, suppressHeaderMenuButton: true, ...byId(id).def })) as unknown as ColDef<AccountGridRow>[];
  }, [saved.columns]);
  /** A column dragged by its header in the grid is the new order, so the Columns panel and the grid agree. */
  const onColumnMoved = useCallback((e: ColumnMovedEvent) => {
    if (!e.finished || e.source === "api") return;
    const ids = e.api.getColumnState().map((s) => s.colId).filter((id) => id !== "name" && id !== "actions");
    if (ids.length === saved.columns.length && ids.some((id, i) => id !== saved.columns[i])) change({ columns: ids });
  }, [saved.columns]);
  const exportCsv = () => apiRef.current?.exportDataAsCsv({
    fileName: "accounts.csv", columnKeys: ["name", ...saved.columns],
    shouldRowBeSkipped: (p) => isHeader(p.node.data),
    processCellCallback: (p) => {
      const d = p.node?.data as AccountRow | undefined;
      const id = p.column.getColId();
      return csvSafe(d && id === "ai_agents" ? agentsText(d) : d && id === "github_state" ? trackerText(d.github_state) : d && id === "jira_state" ? trackerText(d.jira_state) : d && id === "status" ? statusLabel(d) : p.formatValue ? p.formatValue(p.value) : p.value);
    },
  });
  const open = rows.find((r) => r.tenant_id === openId) ?? null;

  return (
    <section className="rp-card rp-wide" aria-label="Accounts">
      <AccountsBar
        filters={filters} onFilters={(f) => { setFilters(f); setCollapsed(new Set()); }} rows={rows} matching={filtered.length}
        allColumns={MOVABLE.map((c) => ({ id: c.id, name: c.label }))} columns={saved.columns} defaultColumns={DEFAULT_COLUMNS} onColumns={(ids) => change({ columns: ids })}
        by={saved.by} then={saved.then} onGroup={(by, then) => { setCollapsed(new Set()); change({ by, then }); }}
        groupKeys={groupKeys} collapsed={collapsed} onCollapse={setCollapsed} onExport={exportCsv}
      />
      <AccountFilterChips filters={filters} onChange={setFilters} />
      <p className="muted" role="status" data-testid="accounts-summary">
        {num(sum.accounts)} {sum.accounts === 1 ? "account" : "accounts"} · {num(sum.members)} members · {num(sum.items)} line items · {num(sum.withAgents)} with AI agents connected · {num(sum.paused)} paused
        {sum.accounts !== rows.length ? ` (${num(rows.length)} in all)` : ""}
      </p>
      {gridRows.length === 0 ? <p className="rp-empty" role="status">No account matches the search or filters</p> : (
        <div className="grid-card">
          <div className="grid-wrap acct-grid" data-testid="accounts-grid">
            <AgGridReact<AccountGridRow>
              theme={GRID_THEME} rowData={gridRows} columnDefs={columnDefs} getRowId={getRowId} context={context} onColumnMoved={onColumnMoved}
              isFullWidthRow={isFullWidthRow} fullWidthCellRenderer={GroupRowRenderer as never}
              defaultColDef={{ ...DEFAULT_COL_DEF }} suppressColumnVirtualisation animateRows={false} tooltipShowDelay={500}
              onGridReady={(e) => { apiRef.current = e.api; }} onRowDoubleClicked={(e) => { if (e.data && !isHeader(e.data)) setOpenId(e.data.tenant_id); }}
            />
          </div>
          <p className="grid-foot">{num(filtered.length)}{filtered.length === rows.length ? "" : ` of ${num(rows.length)}`} accounts · {saved.by ? "Grouped" : "Not grouped"} · Double-click a row or choose Manage for people and actions · Entering an account is logged in that account&rsquo;s audit log</p>
        </div>
      )}
      {open && <AccountDrawer key={open.tenant_id} account={open} emailEnabled={emailEnabled} fixtureMembers={fixtureMembers} onClose={() => setOpenId(null)} />}
    </section>
  );
}
