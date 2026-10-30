import { assistantLabel, CLAUDE_CAN, CLAUDE_CANNOT, claudeMayWrite, detectAssistant, formatDate, setupGuides } from "@pv/domain";
import { requireWorkspace } from "@/lib/session";
import { mcpEnabled } from "@/lib/mcp/auth";
import { siteUrl } from "@/lib/site-url";
import { CopyUrl } from "./copy-url";
import { revokeConnection, setClaudeEnabled, setClaudeSingleOnly } from "./actions";

export const metadata = { title: "Connect an AI assistant · Product Velocity" };

const NOTICE: Record<string, string> = {
  "switched-on": "AI assistants are switched on for this workspace.",
  "switched-off": "AI assistants are switched off for this workspace. Every connection stops working on its next call.",
  "single-on": "AI assistants may now be used in this workspace only on their own. A connection that also covers other workspaces stops working here on its next call.",
  "single-off": "AI assistants may be used in this workspace together with other workspaces again.",
  revoked: "Connection revoked. The assistant's next call will be refused.",
  "already-revoked": "That connection was already revoked.",
  "not-admin": "Only workspace admins can do that.",
  failed: "That did not work. Please try again.",
  "needs-migration": "The database behind this deployment has not had the Claude migrations applied yet (0043, and 0058 for the \"only on its own\" setting), so that cannot be saved. Apply them (docs/11-ENVIRONMENTS.md) and try again.",
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

/** Connect an AI assistant (docs/20 FR-1, docs/27): the connector URL, setup steps for Claude, ChatGPT and Gemini, this person's connections with Revoke, and for admins the workspace switch. */
export default async function ConnectClaudePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const { supabase, user, memberships, active } = await requireWorkspace("/settings/claude");
  const isAdmin = active.role === "admin";
  const url = `${await siteUrl()}/mcp`;

  let { data: tenant, error: tenantError } = await supabase.from("tenants").select("claude_enabled, claude_single_only").eq("id", active.tenantId).single();
  let hasSingleOnly = !tenantError;
  if (tenantError) ({ data: tenant, error: tenantError } = (await supabase.from("tenants").select("claude_enabled").eq("id", active.tenantId).single()) as never); // before migration 0058
  const notMigrated = Boolean(tenantError);
  const enabled = Boolean(tenant?.claude_enabled);
  const singleOnly = Boolean((tenant as { claude_single_only?: boolean } | null)?.claude_single_only);
  hasSingleOnly = hasSingleOnly && !notMigrated;

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
      <h1>Connect an AI assistant</h1>
      {status && NOTICE[status] && <p role="status" className="notice">{NOTICE[status]}</p>}
      <p className="muted">
        Claude, ChatGPT and Gemini connect the same way and can read and draft in {active.tenantName} as you, with your role ({active.role}). Every change an assistant makes is recorded
        as &ldquo;Claude MCP&rdquo; (the source name for every AI assistant) with the connection it came from.
      </p>

      {!mcpEnabled() && (
        <p role="status" className="notice">AI assistant connections are not available on this deployment yet. The connector URL below will work once it is switched on.</p>
      )}
      {notMigrated && (
        <p role="alert" className="notice">This deployment&rsquo;s database has not had migration 0043 applied yet, so the assistant switch and connections are not available. Apply the migration (docs/11-ENVIRONMENTS.md).</p>
      )}
      {!enabled && !notMigrated && (
        <p role="alert" className="notice" id="claude-off">
          AI assistants are switched off for {active.tenantName}, so nobody can connect or use an existing connection.{" "}
          {isAdmin ? "Switch it on below." : "A workspace admin can switch it on."}
        </p>
      )}

      {isAdmin && (
        <>
          <h2>Workspace switch</h2>
          <form action={setClaudeEnabled} className="card stack">
            <label className="check-row">
              <input type="checkbox" name="enabled" defaultChecked={enabled} />
              <span>Allow AI assistants in {active.tenantName}</span>
            </label>
            <p className="muted">
              Off by default. Switching it off stops every connection on its next call; switching it on lets members approve
              an assistant on the consent screen. Today: {usage.items} of {limits.items} items, {Math.round(usage.bytes / (1024 * 1024))} of {limits.mb} MB, {usage.calls} calls
              (daily limits for the workspace, counted in UTC).
            </p>
            <div><button className="btn btn-primary" type="submit" disabled={notMigrated}>Save</button></div>
          </form>
          <form action={setClaudeSingleOnly} className="card stack">
            <label className="check-row">
              <input type="checkbox" name="single_only" defaultChecked={singleOnly} disabled={!hasSingleOnly} />
              <span>AI assistants may be used in {active.tenantName} only on their own</span>
            </label>
            <p className="muted">
              A person can connect an assistant to several of their workspaces at once; it then names the workspace on every request and can read and report across them in one chat.
              Tick this if what is in {active.tenantName} must never be in the same chat as another workspace (for example a client&rsquo;s confidential roadmap).
              A connection that covers other workspaces stops working here; one that covers only {active.tenantName} is not affected.
            </p>
            <div><button className="btn btn-primary" type="submit" disabled={!hasSingleOnly}>Save</button></div>
          </form>
        </>
      )}

      <h2>What an AI assistant can and cannot do</h2>
      <div className="card two-col">
        <div>
          <strong>Can</strong>
          <ul>{CLAUDE_CAN.map((t) => <li key={t}>{t}</li>)}</ul>
          {!claudeMayWrite(active.role) && <p className="muted">With your role ({active.role}) an assistant can read, not change.</p>}
        </div>
        <div>
          <strong>Cannot</strong>
          <ul>{CLAUDE_CANNOT.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      </div>

      <h2>Set it up</h2>
      <div className="card stack">
        <CopyUrl url={url} />
        {setupGuides(url).map((g) => (
          <div key={g.assistant}>
            <p><strong>{g.title}</strong></p>
            <ol>{g.steps.map((t) => <li key={t}>{t}</li>)}</ol>
            {g.snippet && <pre className="code-block" aria-label={`${g.snippet.label} command`}>{g.snippet.code}</pre>}
            {g.note && <p className="muted">{g.note}</p>}
          </div>
        ))}
        <p className="muted">
          Whichever assistant you use, it asks you to sign in to Product Velocity and approve on the consent screen. Menu names in these products change; if a step looks different, look for &ldquo;custom connector&rdquo; or &ldquo;MCP server&rdquo;.
        </p>
      </div>

      <h2>Your connections</h2>
      {mine.length === 0 ? (
        <p className="muted">You have no active connections.</p>
      ) : (
        <table className="table">
          <thead>
            <tr><th>Assistant</th><th>Client</th><th>Workspace</th><th>Created</th><th>Last used</th><th>Calls</th><th><span className="visually-hidden">Actions</span></th></tr>
          </thead>
          <tbody>
            {mine.map((c) => (
              <tr key={c.id}>
                <td>{assistantLabel(detectAssistant(c.client_name))}</td>
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
                <tr><th>Person</th><th>Assistant</th><th>Client</th><th>Created</th><th>Last used</th><th>Calls</th><th><span className="visually-hidden">Actions</span></th></tr>
              </thead>
              <tbody>
                {others.map((c) => (
                  <tr key={c.id}>
                    <td>{people.get(c.user_id) ?? "Former member"}</td>
                    <td>{assistantLabel(detectAssistant(c.client_name))}</td>
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
