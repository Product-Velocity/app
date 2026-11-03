import Link from "next/link";
import { jiraGet } from "@/lib/atlassian/server";
import { webhooksEnabled } from "@/lib/atlassian/jira-webhooks-server";
import { requireWorkspace } from "@/lib/session";

export const metadata = { title: "Test Jira connection · Product Velocity" };
export const maxDuration = 30;

type Check = { label: string; ok: boolean; detail: string };

/** The twin of GitHub's connection test: reads only, shows no secret, no address, no account id and no email. */
export default async function JiraTestPage() {
  const { supabase, active } = await requireWorkspace("/settings/integrations/jira/test");
  const isAdmin = active.role === "admin" && !active.platform;
  const checks: Check[] = [];
  if (isAdmin) {
    const { data: conns } = await supabase.from("jira_connections").select("id, sites, scopes, state").eq("tenant_id", active.tenantId).neq("state", "disconnected");
    if (!conns || conns.length === 0) checks.push({ label: "Connection", ok: false, detail: "Not connected. Connect Jira on the Jira page." });
    for (const c of (conns ?? []) as { id: string; sites: { id: string; name: string }[]; scopes: string; state: string }[]) {
      const name = c.sites.map((s) => s.name).join(", ") || "Jira";
      checks.push({ label: `${name}: sign-in`, ok: c.state === "connected", detail: c.state === "connected" ? "Connected." : "Needs a new sign-in (use Sign in to Jira again on the Jira page)." });
      if (c.state !== "connected") continue;
      const scopes = c.scopes.split(" ");
      checks.push({ label: `${name}: permissions`, ok: scopes.includes("read:jira-work") && scopes.includes("write:jira-work"), detail: `read work: ${scopes.includes("read:jira-work") ? "yes" : "NO"} · write work: ${scopes.includes("write:jira-work") ? "yes" : "NO"} · read users: ${scopes.includes("read:jira-user") ? "yes" : "NO"} · live updates (webhooks): ${scopes.includes("manage:jira-webhook") ? "yes" : "no"}` });
      for (const s of c.sites) {
        try {
          await jiraGet(c.id, s.id, "/myself");
          const p = await jiraGet<{ total?: number; values?: unknown[] }>(c.id, s.id, "/project/search?maxResults=50");
          checks.push({ label: `${s.name}: Jira answers`, ok: true, detail: `Signed in and ${p.values?.length ?? 0} project(s) visible.` });
        } catch (e) {
          checks.push({ label: `${s.name}: Jira answers`, ok: false, detail: e instanceof Error ? e.message.slice(0, 120) : "No answer" });
        }
      }
    }
    const { data: hooks } = await supabase.from("jira_webhooks").select("state, expires_at, last_event_at, events_received, last_error").eq("tenant_id", active.tenantId);
    const rows = (hooks ?? []) as { state: string; expires_at: string | null; last_event_at: string | null; events_received: number; last_error: string | null }[];
    checks.push({
      label: "Live updates",
      ok: webhooksEnabled() && rows.length > 0 && rows.every((r) => r.state === "active"),
      detail: !webhooksEnabled() ? "Not switched on for this deployment. The daily check and Check Jira now keep initiatives current." : rows.length === 0 ? "Nothing registered yet; the daily check registers them." : `${rows.filter((r) => r.state === "active").length} of ${rows.length} project(s) registered · ${rows.reduce((n, r) => n + r.events_received, 0)} event(s) received${rows.some((r) => r.state === "needs_scope") ? " · sign in to Jira again to allow webhooks" : ""}${rows.find((r) => r.last_error) ? ` · last problem: ${rows.find((r) => r.last_error)!.last_error}` : ""}.`,
    });
  }
  const report = checks.map((c) => `${c.ok ? "OK  " : "FAIL"} ${c.label}: ${c.detail}`).join("\n");
  return (
    <div className="page-narrow">
      <p><Link href="/settings/integrations/jira">← Jira</Link></p>
      <h1>Test Jira connection</h1>
      <p className="muted">Checks this workspace&rsquo;s own connection: sign-in, permissions, Jira answering and live updates. It only reads: nothing is written to Jira and no secret is shown. Include the copied report when you ask for help.</p>
      {!isAdmin ? <p className="muted">Only admins can run the test.</p> : (
        <div className="card stack">
          <table className="table">
            <caption className="visually-hidden">Connection test results</caption>
            <thead><tr><th scope="col">Check</th><th scope="col">Result</th><th scope="col">Detail</th></tr></thead>
            <tbody>{checks.map((c) => <tr key={c.label}><td>{c.label}</td><td>{c.ok ? "OK" : "Needs attention"}</td><td>{c.detail}</td></tr>)}</tbody>
          </table>
          <details><summary>Copy the report</summary><pre>{report}</pre></details>
        </div>
      )}
    </div>
  );
}
