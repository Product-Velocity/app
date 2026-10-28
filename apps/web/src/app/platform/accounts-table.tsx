import { formatWhen } from "@/lib/audit-log";
import { deleteAccount, enterAccount, setAccountLevel, setPlan } from "./actions";

export type AccountRow = { tenant_id: string; name: string; plan: string; owner_email: string | null; member_count: number; project_count: number; last_activity: string | null; access_override: string | null };

/** The table of the All accounts console (R-111 FR-2.2). */
export function AccountsTable({ rows }: { rows: AccountRow[] }) {
  return (
    <>
    {rows.length === 0 ? (
      <p role="status" className="muted">No accounts match.</p>
    ) : (
      <div className="table-wrap">
        <table className="data-table" data-testid="accounts-table">
          <caption className="visually-hidden">Accounts</caption>
          <thead>
            <tr><th scope="col">Account</th><th scope="col">Plan</th><th scope="col">Owner</th><th scope="col">Members</th><th scope="col">Projects</th><th scope="col">Last activity</th><th scope="col">Platform access</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.tenant_id} data-testid="account-row">
                <th scope="row">{a.name}</th>
                <td>
                  <form action={setPlan} className="row-form">
                    <input type="hidden" name="tenant" value={a.tenant_id} />
                    <input name="plan" defaultValue={a.plan} maxLength={40} aria-label={`Plan of ${a.name}`} size={9} />
                    <button className="btn" type="submit">Save</button>
                  </form>
                </td>
                <td>{a.owner_email ?? "—"}</td>
                <td>{a.member_count}</td>
                <td>{a.project_count}</td>
                <td>{a.last_activity ? formatWhen(a.last_activity, "UTC", false) : "No activity yet"}</td>
                <td>
                  <form action={setAccountLevel} className="row-form">
                    <input type="hidden" name="tenant" value={a.tenant_id} />
                    <input type="hidden" name="level" value={a.access_override ? "read_write" : "read_only"} />
                    <span>{a.access_override ? "Restricted to read-only" : "Default"}</span>
                    <button className="btn" type="submit">{a.access_override ? "Remove restriction" : "Restrict to read-only"}</button>
                  </form>
                </td>
                <td>
                  <form action={enterAccount} className="row-form">
                    <input type="hidden" name="tenant" value={a.tenant_id} />
                    <input name="reason" maxLength={500} placeholder="Reason (optional)" aria-label={`Reason for entering ${a.name}`} />
                    <button className="btn btn-primary" type="submit" data-testid="enter-account">Enter</button>
                  </form>
                  <details className="delete-account">
                    <summary>Delete…</summary>
                    <form action={deleteAccount} className="stack">
                      <input type="hidden" name="tenant" value={a.tenant_id} />
                      <p className="error">Deletes <strong>{a.name}</strong> with its {a.member_count} members, {a.project_count} projects and all initiatives. This cannot be undone.</p>
                      <label>Type the account name to confirm<input name="confirm_name" autoComplete="off" required aria-label={`Type ${a.name} to confirm deleting it`} /></label>
                      <button className="btn btn-danger" type="submit" data-testid="delete-account">Delete account for good</button>
                    </form>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
    </>
  );
}
