import Link from "next/link";
import { actionLabel, formatValue, formatWhen, roleAtTime, viaLabel, whoLabel, entityLabel, type AuditFilters, type AuditLookup, type AuditRow } from "@/lib/audit-log";

type Props = {
  rows: AuditRow[];
  lookup: AuditLookup;
  filters: AuditFilters;
  basePath: string;
  exportPath: string;
  projects: { id: string; name: string }[];
  showAccount: boolean;
  accounts?: { id: string; name: string }[];
  accountFilter?: string;
  more: boolean;
  timeZone: string;
};

/** The audit log (R-111 FR-6): who, role, when, where, what and how, with filters and export. Read-only: nothing here edits an entry. */
export function AuditView({ rows, lookup, filters, basePath, exportPath, projects, showAccount, accounts, accountFilter, more, timeZone }: Props) {
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const all: Record<string, string | undefined> = { actor: filters.actor, action: filters.action, project: filters.project, from: filters.from, to: filters.to, account: accountFilter, ...extra };
    for (const [k, v] of Object.entries(all)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const last = rows.at(-1);
  return (
    <>
      <form method="get" action={basePath} className="filter-bar" aria-label="Filter the audit log">
        {accounts && (
          <label>Account
            <select name="account" defaultValue={accountFilter ?? ""}>
              <option value="">All accounts</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}
        <label>Person or email<input name="actor" defaultValue={filters.actor ?? ""} maxLength={120} placeholder="Name or email" /></label>
        <label>Action<input name="action" defaultValue={filters.action ?? ""} maxLength={120} placeholder="e.g. status, entered" /></label>
        <label>Project
          <select name="project" defaultValue={filters.project ?? ""}>
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label>From<input type="date" name="from" defaultValue={filters.from ?? ""} /></label>
        <label>To<input type="date" name="to" defaultValue={filters.to ?? ""} /></label>
        <button className="btn btn-primary" type="submit">Filter</button>
        <Link className="btn" href={basePath}>Clear</Link>
        <a className="btn" href={`${exportPath}${qs({})}`} download>Export CSV</a>
      </form>
      {rows.length === 0 ? (
        <p role="status" className="muted">No entries match.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table" data-testid="audit-table">
            <caption className="visually-hidden">Audit log, newest first</caption>
            <thead>
              <tr>
                <th scope="col">When</th><th scope="col">Who</th><th scope="col">Role</th><th scope="col">Where</th><th scope="col">What</th><th scope="col">Old</th><th scope="col">New</th><th scope="col">How</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid="audit-row">
                  <td><time dateTime={r.at}>{formatWhen(r.at, timeZone)}</time></td>
                  <td>
                    {whoLabel(r)}
                    {r.actor_platform_admin && <span className="badge-platform" data-testid="platform-badge">Platform admin</span>}
                  </td>
                  <td>{roleAtTime(r.actor_role)}</td>
                  <td>
                    {showAccount && <div>{lookup.accounts?.[r.tenant_id] ?? "Account"}</div>}
                    {r.project_id && <div>{lookup.projects?.[r.project_id] ?? "Project"}</div>}
                    <div className="muted">{r.entity_id ? lookup.objects?.[r.entity_id] ?? entityLabel(r.entity) : entityLabel(r.entity)}{r.screen ? ` · ${r.screen}` : ""}</div>
                  </td>
                  <td>{actionLabel(r)}{r.batch_id && <div className="muted" title={r.batch_id}>batch {r.batch_id.slice(0, 8)}</div>}</td>
                  <td>{formatValue(r.old)}</td>
                  <td>{formatValue(r.new)}</td>
                  <td>{viaLabel(r.via)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more && last && <p><Link className="btn" href={`${basePath}${qs({ before: String(last.id) })}`}>Older entries</Link></p>}
    </>
  );
}
