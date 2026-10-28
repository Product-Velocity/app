import { requirePlatformAdmin } from "@/lib/session";
import { formatWhen } from "@/lib/audit-log";
import { setAdminLevel, setDefaultLevel, setPlatformAdmin } from "../actions";

export const metadata = { title: "Access settings · Product Velocity" };

const NOTICE: Record<string, string> = {
  "default-saved": "Default access saved. It is recorded in the configuration log.",
  "admin-saved": "Access for that admin saved. It is recorded in the configuration log.",
  "admin-added": "Platform admin added.",
  "admin-removed": "Platform admin removed. Any account they were in was closed.",
  "bad-level": "Choose read & write or read-only.",
  "bad-email": "Enter a valid email address.",
  "no-such-user": "No confirmed Product Velocity account has that email. They must sign up and confirm it first.",
  self: "You cannot remove yourself.",
  failed: "That did not work. Please try again.",
};
type Admin = { user_id: string; email: string; name: string; active: boolean; access_level: string | null; effective_level: string };
type LogRow = { id: number; at: string; actor_name: string; actor_email: string; field: string; old: unknown; new: unknown };

const FIELD: Record<string, string> = { default_access_level: "Platform default access", admin_access_level: "Access of one admin", account_access_level: "Access to one account", platform_admin: "Platform admin", plan: "Plan" };
const show = (v: unknown) => (v === null || v === undefined ? "default" : String(v).replace("_", " "));

/** Access level configuration (R-111 FR-2.5): platform default, per admin, and the log of every change (FR-2.7). */
export default async function PlatformSettingsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  const { supabase, user } = await requirePlatformAdmin("/platform/settings");
  const [{ data: cfg }, { data: admins }, { data: log }] = await Promise.all([
    supabase.rpc("platform_config"), supabase.rpc("platform_admin_list"), supabase.rpc("platform_config_log", { p_limit: 100 }),
  ]);
  const def = ((Array.isArray(cfg) ? cfg[0] : cfg) as { default_access_level: string } | undefined)?.default_access_level ?? "read_write";
  return (
    <div className="page-narrow">
      <h1>Access settings</h1>
      <p className="muted">What platform admins may do inside a customer account. Read-only is enforced by the server: edit controls are disabled and writes are refused.</p>
      {notice && NOTICE[notice] && <p role="status" className={["failed", "self", "no-such-user", "bad-email", "bad-level"].includes(notice) ? "notice notice-error" : "notice"}>{NOTICE[notice]}</p>}

      <h2>Platform default</h2>
      <form action={setDefaultLevel} className="card row-form">
        <label>Default access
          <select name="level" defaultValue={def} data-testid="default-level-select">
            <option value="read_write">Read &amp; write</option>
            <option value="read_only">Read-only</option>
          </select>
        </label>
        <button className="btn btn-primary" type="submit">Save</button>
      </form>

      <h2>Platform admins</h2>
      <div className="card stack">
        <table className="data-table">
          <thead><tr><th scope="col">Admin</th><th scope="col">Access</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>
            {((admins ?? []) as Admin[]).filter((a) => a.active).map((a) => (
              <tr key={a.user_id}>
                <td>{a.name} ({a.email}){a.user_id === user.id && " — you"}</td>
                <td>
                  <form action={setAdminLevel} className="row-form">
                    <input type="hidden" name="user" value={a.user_id} />
                    <select name="level" defaultValue={a.access_level ?? "default"} aria-label={`Access of ${a.email}`}>
                      <option value="default">Follow the default ({def === "read_only" ? "read-only" : "read & write"})</option>
                      <option value="read_write">Read &amp; write</option>
                      <option value="read_only">Read-only</option>
                    </select>
                    <button className="btn" type="submit">Save</button>
                  </form>
                </td>
                <td>
                  {a.user_id !== user.id && (
                    <form action={setPlatformAdmin}><input type="hidden" name="email" value={a.email} /><input type="hidden" name="active" value="false" /><button className="btn" type="submit">Remove</button></form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={setPlatformAdmin} className="row-form">
          <label>Add a platform admin by email<input name="email" type="email" required maxLength={254} /></label>
          <input type="hidden" name="active" value="true" />
          <button className="btn" type="submit">Add</button>
        </form>
        <p className="muted">An account can also be limited to read-only for all platform admins from the All accounts page.</p>
      </div>

      <h2>Configuration log</h2>
      <div className="card table-wrap">
        <table className="data-table" data-testid="config-log">
          <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">What</th><th scope="col">From</th><th scope="col">To</th></tr></thead>
          <tbody>
            {((log ?? []) as LogRow[]).map((r) => (
              <tr key={r.id}><td>{formatWhen(r.at)}</td><td>{r.actor_name} ({r.actor_email})</td><td>{FIELD[r.field] ?? r.field}</td><td>{show(r.old)}</td><td>{show(r.new)}</td></tr>
            ))}
            {(log ?? []).length === 0 && <tr><td colSpan={5} className="muted">No changes yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
