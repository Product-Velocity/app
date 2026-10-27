import { CLAUDE_CAN, CLAUDE_CANNOT, claudeMayWrite, formatDate } from "@pv/domain";
import { requireWorkspace } from "@/lib/session";
import { mcpEnabled } from "@/lib/mcp/auth";
import { siteUrl } from "@/lib/site-url";
import { CopyUrl } from "./copy-url";
import { revokeConnection, setClaudeEnabled } from "./actions";

export const metadata = { title: "Connect Claude · Product Velocity" };

const NOTICE: Record<string, string> = {
  "switched-on": "Claude is switched on for this workspace.",
  "switched-off": "Claude is switched off for this workspace. Every connection stops working on its next call.",
  revoked: "Connection revoked. Claude's next call will be refused.",
  "already-revoked": "That connection was already revoked.",
  "not-admin": "Only workspace admins can do that.",
  failed: "That did not work. Please try again.",
  "needs-migration": "This deployment's database has not had migration 0043 applied yet, so the Claude switch cannot be saved. Apply the migration (docs/11-ENVIRONMENTS.md) and try again.",
};

type Conn = {
  id: string;
  tenant_id: string;
  user_id: string;
  client_id: string;
  client_name: string;
  created_at: string;
  last_used_at: string | null;
  call_count: number;
  revoked_at: string | null;
};

const day = (iso: string | null) => (iso ? formatDate(iso.slice(0, 10), new Date()) : "Never");

/** Connect Claude (docs/20 FR-1): the connector URL, setup steps, this person's connections with Revoke, and for admins the workspace switch. */
export default async function ConnectClaudePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const { supabase, user, memberships, active } = await requireWorkspace("/settings/claude");
  const isAdmin = active.role === "admin";
  const url = `${await siteUrl()}/mcp`;

  const { data: tenant, error: tenantError } = await supabase.from("tenants").select("claude_enabled").eq("id", active.tenantId).single();
  const notMigrated = Boolean(tenantError);
  const enabled = Boolean(tenant?.claude_enabled);

  // RLS: a person sees their own connections; an admin also sees everyone's in the workspaces they administer (no content)
  const { data: rows } = await supabase
    .from("mcp_connections")
    .select("id, tenant_id, user_id, client_id, client_name, created_at, last_used_at, call_count, revoked_at")
    .order("created_at", { ascending: false });
  const all = (rows ?? []) as Conn[];
  const workspaceName = (id: string) => memberships.find((m) => m.tenantId === id)?.tenantName ?? "Workspace";
  const mine = all.filter((c) => c.user_id === user.id && !c.revoked_at);
  const others = all.filter((c) => c.tenant_id === active.tenantId && c.user_id !== user.id && !c.revoked_at);

  let people = new Map<string, string>();
  let usage = { items: 0, bytes: 0, calls: 0 };
  let limits = { items: 200, mb: 100 };
  if (isAdmin) {
    const { data: dir } = await supabase.rpc("tenant_directory", { p_tenant: active.tenantId });
    people = new Map((dir ?? []).map((p: { user_id: string; email: string }) => [p.user_id, p.email]));
    const { data: l } = await supabase.rpc("mcp_limits");
    if (l) limits = { items: Number(l.workspace_items_per_day), mb: Math.round(Number(l.workspace_bytes_per_day) / (1024 * 1024)) };
    const today = new Date().toISOString().slice(0, 10);
    const { data: u } = await supabase.from("ai_usage").select("calls, items_written, bytes_uploaded").eq("tenant_id", active.tenantId).eq("day", today);
    for (const r of u ?? []) usage = { items: usage.items + r.items_written, bytes: usage.bytes + Number(r.bytes_uploaded), calls: usage.calls + r.calls };
  }

  return (
    <div className="page-narrow">
      <h1>Connect Claude</h1>
      {status && NOTICE[status] && <p role="status" className="notice">{NOTICE[status]}</p>}
      <p className="muted">
        Claude can read and draft in {active.tenantName} as you, with your role ({active.role}). Every change it makes is recorded as
        &ldquo;Claude MCP&rdquo; with the connection it came from.
      </p>

      {!mcpEnabled() && (
        <p role="status" className="notice">Claude connections are not available on this deployment yet. The connector URL below will work once it is switched on.</p>
      )}
      {notMigrated && (
        <p role="alert" className="notice">This deployment's database has not had migration 0043 applied yet, so the Claude switch and connections are not available. Apply the migration (docs/11-ENVIRONMENTS.md).</p>
      )}
      {!enabled && !notMigrated && (
        <p role="alert" className="notice" id="claude-off">
          Claude is switched off for {active.tenantName}, so nobody can connect or use an existing connection.{" "}
          {isAdmin ? "Switch it on below." : "A workspace admin can switch it on."}
        </p>
      )}

      {isAdmin && (
        <>
          <h2>Workspace switch</h2>
          <form action={setClaudeEnabled} className="card stack">
            <label className="check-row">
              <input type="checkbox" name="enabled" defaultChecked={enabled} />
              <span>Allow Claude in {active.tenantName}</span>
            </label>
            <p className="muted">
              Off by default. Switching it off stops every connection on its next call; switching it on lets members approve
              Claude on the consent screen. Today: {usage.items} of {limits.items} items, {Math.round(usage.bytes / (1024 * 1024))} of {limits.mb} MB, {usage.calls} calls
              (daily limits for the workspace, counted in UTC).
            </p>
            <div><button className="btn btn-primary" type="submit" disabled={notMigrated}>Save</button></div>
          </form>
        </>
      )}

      <h2>What Claude can and cannot do</h2>
      <div className="card two-col">
        <div>
          <strong>Can</strong>
          <ul>{CLAUDE_CAN.map((t) => <li key={t}>{t}</li>)}</ul>
          {!claudeMayWrite(active.role) && <p className="muted">With your role ({active.role}) Claude can read, not change.</p>}
        </div>
        <div>
          <strong>Cannot</strong>
          <ul>{CLAUDE_CANNOT.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      </div>

      <h2>Set it up</h2>
      <div className="card stack">
        <CopyUrl url={url} />
        <p><strong>In claude.ai or the Claude desktop app</strong></p>
        <ol>
          <li>Open Settings, then Connectors, and choose Add custom connector.</li>
          <li>Paste the connector URL above and name it Product Velocity.</li>
          <li>Connect, sign in if asked, choose the workspace and approve on the consent screen.</li>
        </ol>
        <p><strong>In Claude Code</strong></p>
        <ol>
          <li>Run <code>claude mcp add --transport http product-velocity {url}</code></li>
          <li>Run <code>/mcp</code> in Claude Code, choose product-velocity and authenticate.</li>
        </ol>
      </div>

      <h2>Your connections</h2>
      {mine.length === 0 ? (
        <p className="muted">You have no active connections.</p>
      ) : (
        <table className="table">
          <thead>
            <tr><th>Client</th><th>Workspace</th><th>Created</th><th>Last used</th><th>Calls</th><th><span className="visually-hidden">Actions</span></th></tr>
          </thead>
          <tbody>
            {mine.map((c) => (
              <tr key={c.id}>
                <td>{c.client_name}</td>
                <td>{workspaceName(c.tenant_id)}</td>
                <td>{day(c.created_at)}</td>
                <td>{day(c.last_used_at)}</td>
                <td>{c.call_count}</td>
                <td>
                  <form action={revokeConnection}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="client_id" value={c.client_id} />
                    <input type="hidden" name="own" value="1" />
                    <button className="btn" type="submit" aria-label={`Revoke ${c.client_name} in ${workspaceName(c.tenant_id)}`}>Revoke</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {isAdmin && (
        <>
          <h2>Everyone&rsquo;s connections in {active.tenantName}</h2>
          <p className="muted">Who connected, with which client, and how often. You see no content here.</p>
          {others.length === 0 ? (
            <p className="muted">Nobody else has an active connection.</p>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Person</th><th>Client</th><th>Created</th><th>Last used</th><th>Calls</th><th><span className="visually-hidden">Actions</span></th></tr>
              </thead>
              <tbody>
                {others.map((c) => (
                  <tr key={c.id}>
                    <td>{people.get(c.user_id) ?? "Former member"}</td>
                    <td>{c.client_name}</td>
                    <td>{day(c.created_at)}</td>
                    <td>{day(c.last_used_at)}</td>
                    <td>{c.call_count}</td>
                    <td>
                      <form action={revokeConnection}>
                        <input type="hidden" name="id" value={c.id} />
                        <button className="btn" type="submit" aria-label={`Revoke ${c.client_name} for ${people.get(c.user_id) ?? "a former member"}`}>Revoke</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
