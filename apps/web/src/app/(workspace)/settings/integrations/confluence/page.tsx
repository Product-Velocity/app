import Link from "next/link";
import { CONFLUENCE_OPTIONAL, CONFLUENCE_REQUIRED, CONFLUENCE_SCOPES, atlassianConfig } from "@/lib/atlassian/oauth";
import { keyRing } from "@/lib/atlassian/token-crypto";
import { requireWorkspace } from "@/lib/session";
import { disconnectConfluence, startConfluenceConnect, testConfluence } from "./actions";
import { PendingButton, ResultBox } from "./confluence-buttons";

export const metadata = { title: "Confluence · Product Velocity" };

const NOTICE: Record<string, string> = {
  connected: "Confluence is connected.",
  disconnected: "Confluence was disconnected. The saved sign-in was deleted. Jira was not touched. You can also remove Product Velocity under connected apps in your Atlassian account.",
  "bad-link": "That link is no longer valid or belongs to someone else. Start the connection again.",
  "not-admin": "Only workspace admins can connect Confluence.",
  "not-configured": "Confluence is not set up for this deployment: the platform owner has to set the Atlassian app variables.",
  denied: "Atlassian did not give access. Nothing was connected.",
  error: "Something went wrong while connecting. Nothing was changed; try again.",
  "no-site": "The sign-in did not reach a Confluence site. Choose a site that has Confluence, and allow every permission asked for.",
  "not-connected": "Confluence is not connected yet.",
};
const PROBLEMS = new Set(["bad-link", "not-admin", "not-configured", "denied", "error", "no-site", "not-connected"]);
const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const WHAT: Record<string, string> = { "read:space:confluence": "See which spaces exist", "read:page:confluence": "Read a page (its text and version)", "write:page:confluence": "Create and update pages" };

type Row = { id: string; sites: { id: string; name: string; url: string }[]; scopes: string; state: "connected" | "reconnect_needed" | "disconnected"; created_at: string; state_changed_at: string };

export default async function ConfluenceSettingsPage({ searchParams }: { searchParams: Promise<{ status?: string; test?: string; n?: string; why?: string }> }) {
  const { status, test, n, why } = await searchParams;
  const { supabase, active } = await requireWorkspace("/settings/integrations/confluence");
  const canAdmin = active.role === "admin" && !active.platform;
  const configured = Boolean(atlassianConfig() && keyRing());
  const { data } = await supabase.from("confluence_connections").select("id, sites, scopes, state, created_at, state_changed_at").eq("tenant_id", active.tenantId).neq("state", "disconnected").order("created_at", { ascending: false }).limit(1);
  const c = ((data ?? []) as Row[])[0] ?? null;
  const granted = new Set((c?.scopes ?? "").split(/\s+/));
  const missing = c ? CONFLUENCE_REQUIRED.filter((s) => !granted.has(s)) : [];
  const noFolders = c ? CONFLUENCE_OPTIONAL.some((s) => !granted.has(s)) : false;

  return (
    <div className="page-full">
      <h1>Confluence</h1>
      <p className="muted">
        Publish a document to a Confluence page, and read a linked page. Confluence has its own connection: connecting, reconnecting or disconnecting it never changes your Jira connection, project links or field mapping.
        Product Velocity writes a page only after a person confirms a preview, and never changes who can see a page.
      </p>
      {!configured && <p role="alert" className="notice">Confluence is not set up for this deployment: the platform owner has to set the Atlassian app variables.</p>}
      {c?.state === "reconnect_needed" && <p role="alert" className="notice">Atlassian no longer accepts the saved sign-in. Reconnect to keep publishing; nothing else is lost.</p>}

      <div className="card stack">
        <h2>Connection</h2>
        {!c && <p><strong>Not connected</strong></p>}
        {c && (
          <>
            <p><strong>{c.state === "connected" ? "Connected" : "Needs a new sign-in"}</strong> · {c.sites.map((s) => s.name).join(", ") || "Confluence"} · since {date(c.created_at)}</p>
            <div>
              <p className="muted">Permissions Atlassian granted to this sign-in:</p>
              <ul>
                {CONFLUENCE_REQUIRED.map((s) => (
                  <li key={s}>{granted.has(s) ? "✓ Granted" : "✗ Missing"} · {WHAT[s]} <code>{s}</code></li>
                ))}
              </ul>
              {missing.length === 0 && noFolders && <p className="muted">This connection cannot read Confluence folders, so pages kept in folders are not listed. Reconnect to allow it (the Atlassian app needs {CONFLUENCE_OPTIONAL.map((s) => <code key={s}>{s} </code>)}).</p>}
              {missing.length > 0 && <p role="alert" className="notice">Some permissions are missing, so Confluence will refuse some requests (Atlassian answers 401 or 403). Reconnect and allow every permission; if Atlassian does not offer one, the Atlassian app in the developer console has to include it first.</p>}
            </div>
          </>
        )}
        {canAdmin ? (
          <div className="row-form">
            {!c && <form action={startConfluenceConnect}><PendingButton className="btn btn-primary" label="Connect Confluence" pendingLabel="Opening Atlassian…" disabled={!configured} /></form>}
            {c && <form action={testConfluence}><PendingButton label="Test connection" pendingLabel="Testing…" disabled={!configured || c.state !== "connected"} /></form>}
            {c && <form action={startConfluenceConnect}><PendingButton label="Reconnect (keeps everything)" pendingLabel="Opening Atlassian…" disabled={!configured} /></form>}
            {c && (
              <form action={disconnectConfluence}>
                <input type="hidden" name="id" value={c.id} />
                <PendingButton className="btn btn-danger-quiet" label="Disconnect Confluence" pendingLabel="Disconnecting…" />
              </form>
            )}
          </div>
        ) : (
          <p className="muted">Only a workspace admin can connect or change this.</p>
        )}
        {test === "ok" && <ResultBox kind="ok">✓ The test worked: Confluence answered with {n ?? "0"} space{n === "1" ? "" : "s"}. Publishing and reading pages can use this connection.</ResultBox>}
        {test === "fail" && <ResultBox kind="fail">✗ The test failed. {why}</ResultBox>}
        {status && NOTICE[status] && <ResultBox kind={PROBLEMS.has(status) ? "fail" : "ok"}>{PROBLEMS.has(status) ? "✗ " : "✓ "}{NOTICE[status]}</ResultBox>}
        {c && canAdmin && (
          <p className="muted">
            Reconnect signs in again and replaces the saved sign-in; nothing in Product Velocity changes. Disconnect deletes only the saved Confluence sign-in: documents already published keep their records and pages stay where they are,
            but publishing and reading pages stop until you connect again. Jira is not affected either way.
          </p>
        )}
      </div>

      {canAdmin && (
        <div className="card stack">
          <h2>Before the first connection</h2>
          <p className="muted">
            The Atlassian app (in the Atlassian developer console, under Permissions, Confluence API) must include these permissions, or Atlassian refuses the sign-in: {CONFLUENCE_SCOPES.filter((s) => s !== "offline_access").map((s) => <code key={s}>{s} </code>)}.
            You approve them on Atlassian&rsquo;s screen; Product Velocity never asks to change a site&rsquo;s settings or who can see a page. Product Velocity reads and writes Confluence with this one sign-in, so it can reach whatever the account that signed in can reach: connect with an account that sees only what should be used here.
          </p>
          <p className="muted">Jira is connected separately under <Link href="/settings/integrations/jira">Settings, Integrations, Jira</Link>.</p>
        </div>
      )}
    </div>
  );
}
