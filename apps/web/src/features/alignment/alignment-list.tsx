"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { METHODS, STATE_LABEL, STATES } from "@/lib/alignment";
import {
  NEED_LABEL, NO_FILTERS, filterRows, needCounts, participation, quarterOptions, quarterText, sortRows, summarize, appliedState,
  type Filters, type Need, type SessionRow, type SortKey,
} from "@/lib/alignment-list";
import { NewSessionDialog, type CreateSession, type Initiative } from "./new-session-dialog";

const NEEDS: Need[] = ["no-participants", "confirm-mailing", "closing-soon", "not-applied"];
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "–");
const methodName = (m: SessionRow["method"]) => METHODS.find((x) => x.value === m)?.label ?? m;

type Col = { key: string; label: string; sort: SortKey | null; admin?: boolean; cell: (r: SessionRow) => React.ReactNode };

/**
 * The Alignment tab (issue #392): every alignment session of the workspace, past and present, with a stats strip and "needs you" chips for admins,
 * search and filters, and a sortable table. Everyone else sees only closed sessions that allow results, and none of the admin-only values
 * (the database decides which rows they get, and `stats` is null for them). Totals only: nothing here is about a person.
 */
export function AlignmentList({ rows, isAdmin, people, initiatives, create, onCreated, now }: {
  rows: SessionRow[]; isAdmin: boolean; people: Record<string, string>; initiatives: Initiative[]; create: CreateSession; onCreated?: (id: string) => void; now?: Date;
}) {
  const router = useRouter();
  const clock = useMemo(() => now ?? new Date(), [now]);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "created", dir: "desc" });
  const [dialog, setDialog] = useState(false);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  const shown = useMemo(() => sortRows(filterRows(rows, filters, clock), sort.key, sort.dir), [rows, filters, clock, sort]);
  const totals = useMemo(() => summarize(shown), [shown]);
  const counts = useMemo(() => needCounts(rows.filter((r) => r.status !== "archived" || filters.showArchived), clock), [rows, filters.showArchived, clock]);
  const quarters = useMemo(() => quarterOptions(rows), [rows]);
  const creators = useMemo(() => [...new Set(rows.map((r) => r.createdBy).filter((x): x is string => !!x))], [rows]);
  const filtered = JSON.stringify({ ...filters, showArchived: false }) !== JSON.stringify({ ...NO_FILTERS, showArchived: false }) || filters.showArchived;
  const link = (r: SessionRow) => (isAdmin ? `/alignment/${r.id}` : `/alignment/${r.id}/results`);

  const cols: Col[] = [
    { key: "name", label: "Session", sort: "name", cell: (r) => <Link href={link(r)}>{r.name}</Link> },
    { key: "method", label: "Method", sort: null, cell: (r) => methodName(r.method) },
    { key: "status", label: "Status", sort: "status", cell: (r) => STATE_LABEL[r.status] },
    { key: "created", label: "Created", sort: "created", cell: (r) => day(r.createdAt) },
    { key: "closed", label: "Closes or closed", sort: "closed", cell: (r) => (r.closedAt ? day(r.closedAt) : r.closesAt ? `${day(r.closesAt)} (planned)` : "By hand") },
    { key: "quarter", label: "Planned quarter", sort: "quarter", cell: (r) => (
      <>
        {quarterText(r)}
        {r.quarters.length > 1 && <span className="muted" title={`Also ${r.quarters.filter((q) => q !== r.quarter).join(", ")}`}> +{r.quarters.length - 1}<span className="sr-only"> more: {r.quarters.filter((q) => q !== r.quarter).join(", ")}</span></span>}
      </>
    ) },
    { key: "initiatives", label: "Initiatives", sort: "initiatives", cell: (r) => r.initiatives },
    { key: "invited", label: "Invited", sort: "invited", admin: true, cell: (r) => r.stats?.invited ?? "–" },
    { key: "voted", label: "Voted", sort: "voted", admin: true, cell: (r) => r.stats?.voted ?? "–" },
    { key: "participation", label: "Participation", sort: "participation", admin: true, cell: (r) => { const p = participation(r.stats); return p === null ? "–" : `${p}%`; } },
    { key: "contested", label: "Contested", sort: "contested", cell: (r) => (r.contested === null ? "–" : r.contested) },
    { key: "applied", label: "Applied to Stack Rank", sort: "applied", admin: true, cell: (r) => {
      const a = appliedState(r);
      return a === "applied" ? `Applied ${day(r.stats!.applied!.at)} (${r.stats!.applied!.moved} moved)` : a === "undone" ? "Undone" : a === "not-applied" ? "Not applied" : "–";
    } },
    { key: "by", label: "Created by", sort: null, admin: true, cell: (r) => (r.createdBy ? people[r.createdBy] ?? "–" : "–") },
  ];
  const visible = cols.filter((c) => !c.admin || isAdmin);
  const sortBy = (k: SortKey) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: k === "name" ? "asc" : "desc" }));

  return (
    <div className="page-wide alignment-list">
      <div className="page-head">
        <h1>Alignment</h1>
        {isAdmin && <button type="button" className="btn btn-primary" onClick={() => setDialog(true)}>New session</button>}
      </div>
      <p className="muted">
        Ask a group of people to rank initiatives: the top five with duels, 100 coins, or ICE sliders. Participants need no account and see only anonymous results.
        {isAdmin ? " You can also select initiatives in the roadmap and press Start alignment session…." : " You see the sessions that have closed and allow results."}
      </p>

      {isAdmin && rows.length > 0 && (
        <>
          <dl className="al-stats" aria-label="Totals for the sessions shown">
            <div><dt>Sessions</dt><dd>{totals.sessions}</dd></div>
            <div><dt>People invited</dt><dd>{totals.invited}</dd></div>
            <div><dt>Participation</dt><dd>{totals.participation === null ? "–" : `${totals.participation}%`}</dd></div>
            <div><dt>Initiatives ranked</dt><dd>{totals.initiativesRanked}</dd></div>
            <div><dt>Results applied</dt><dd>{totals.applied}</dd></div>
          </dl>
          <div className="al-needs" role="group" aria-label="Needs you">
            {NEEDS.some((n) => counts[n] > 0) ? NEEDS.filter((n) => counts[n] > 0).map((n) => (
              <button key={n} type="button" className={`al-chip${filters.need === n ? " is-on" : ""}`} aria-pressed={filters.need === n} onClick={() => set("need", filters.need === n ? "" : n)}>
                {NEED_LABEL[n]} <strong>{counts[n]}</strong>
              </button>
            )) : <span className="muted">Nothing needs you right now.</span>}
          </div>
        </>
      )}

      {rows.length > 0 && (
        <div className="al-toolbar" role="search" aria-label="Find sessions">
          <label className="al-field"><span>Search</span><input type="search" aria-label="Search" value={filters.q} onChange={(e) => set("q", e.target.value)} placeholder="Session or initiative" /></label>
          <label className="al-field"><span>Status</span>
            <select aria-label="Status" value={filters.status} onChange={(e) => set("status", e.target.value as Filters["status"])}>
              <option value="">Any status</option>
              {STATES.filter((s) => isAdmin || s !== "draft" && s !== "open").map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="al-field"><span>Method</span>
            <select aria-label="Method" value={filters.method} onChange={(e) => set("method", e.target.value as Filters["method"])}><option value="">Any method</option>{METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
          </label>
          <label className="al-field"><span>Planned quarter</span>
            <select aria-label="Planned quarter" value={filters.quarter} onChange={(e) => set("quarter", e.target.value)}><option value="">Any planned quarter</option>{quarters.map((q) => <option key={q} value={q}>{q}</option>)}</select>
          </label>
          {isAdmin && (
            <>
              <label className="al-field"><span>Applied</span>
                <select aria-label="Applied" value={filters.applied} onChange={(e) => set("applied", e.target.value as Filters["applied"])}>
                  <option value="">Any</option><option value="applied">Applied</option><option value="not-applied">Not applied</option><option value="undone">Undone</option>
                </select>
              </label>
              <label className="al-field"><span>Created by</span>
                <select aria-label="Created by" value={filters.createdBy} onChange={(e) => set("createdBy", e.target.value)}><option value="">Anyone</option>{creators.map((c) => <option key={c} value={c}>{people[c] ?? c}</option>)}</select>
              </label>
            </>
          )}
          <label className="al-check"><input type="checkbox" checked={filters.showArchived} onChange={(e) => set("showArchived", e.target.checked)} /> Show archived</label>
          {filtered && <button type="button" className="btn" onClick={() => setFilters(NO_FILTERS)}>Clear filters</button>}
        </div>
      )}

      {rows.length === 0 ? (
        <p role="status">{isAdmin ? "No alignment sessions yet. Press New session to start one." : "No results to show yet. A session appears here when it has closed and allows results."}</p>
      ) : (
        <>
          <p className="muted" role="status">{shown.length} {shown.length === 1 ? "session" : "sessions"}{filtered ? " match" : ""}.</p>
          {shown.length === 0 ? <p>No session matches. Clear the filters to see them all.</p> : (
            <div className="table-wrap">
              <table className="table al-table">
                <caption className="sr-only">Alignment sessions</caption>
                <thead>
                  <tr>
                    {visible.map((c) => (
                      <th key={c.key} scope="col" aria-sort={c.sort && sort.key === c.sort ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                        {c.sort ? <button type="button" className="th-sort" onClick={() => sortBy(c.sort!)}>{c.label}{sort.key === c.sort ? <span aria-hidden="true"> {sort.dir === "asc" ? "▲" : "▼"}</span> : null}</button> : c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id}>
                      {visible.map((c) => (c.key === "name"
                        ? <th key={c.key} scope="row" data-label={c.label}>{c.cell(r)}</th>
                        : <td key={c.key} data-label={c.label}>{c.cell(r)}</td>))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {dialog && <NewSessionDialog initiatives={initiatives} create={create} onClose={() => setDialog(false)} onCreated={(id) => (onCreated ? onCreated(id) : router.push(`/alignment/${id}`))} />}
    </div>
  );
}
