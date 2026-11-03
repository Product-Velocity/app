import Link from "next/link";
import { requireWorkspace } from "@/lib/session";
import type { ConnectionRow } from "@/lib/github/server";
import { TrackerTabs } from "@/components/tracker-tabs";
import { AutoRefresh } from "../auto-refresh";
import { RefreshButton } from "../refresh-button";
import { checkGithubNow, retrySyncEvent } from "../actions";
import { NOTICE } from "../shared";

/** "Check GitHub now" reads every linked issue and its sub-issues: allow the longest run the plan offers. */
export const maxDuration = 60;

export const metadata = { title: "GitHub sync logs · Product Velocity" };

type SyncEvent = { id: string; received_at: string; source: string; event: string; action: string | null; issue_number: number | null; repo_full_name: string | null; state: string; last_error: string | null; attempts: number; applied: Record<string, [unknown, unknown]> | null };

/** Settings → Integrations → GitHub → Sync logs: what the sync did (decision 2026-11-03-tracker-field-config). The same section exists for Jira. */
export default async function GithubLogsPage({ searchParams }: { searchParams: Promise<{ status?: string; c?: string; ch?: string; m?: string; why?: string }> }) {
  const { status, c: checkedN, ch: changedN, m: missingN, why } = await searchParams;
  const { supabase, active } = await requireWorkspace("/settings/integrations/github/logs");
  const isAdmin = active.role === "admin";
  const { data: conn } = await supabase.from("github_connections").select("*").eq("tenant_id", active.tenantId).neq("state", "disconnected").maybeSingle();
  const c = conn as (ConnectionRow & { last_check_at: string | null; last_check_summary: string | null }) | null;
  const { data: eventRows } = isAdmin && c ? await supabase.from("sync_events").select("id, received_at, source, event, action, issue_number, repo_full_name, state, last_error, attempts, applied").eq("tenant_id", active.tenantId).order("received_at", { ascending: false }).limit(15) : { data: [] };
  const events = (eventRows ?? []) as SyncEvent[];
  const { count: linkedCount } = c ? await supabase.from("item_github_links").select("id", { count: "exact", head: true }).eq("tenant_id", active.tenantId) : { count: 0 };

  return (
    <div className="page-narrow">
      <h1>GitHub</h1>
      <TrackerTabs base="/settings/integrations/github" current="logs" tracker="GitHub" />
      {status && NOTICE[status] && <p role="status" className="notice">{NOTICE[status]}</p>}
      {status === "error" && why && <p role="alert" className="notice">Reason: {why.slice(0, 200)}</p>}
      {status === "checked" && <p role="status" className="notice">Checked {checkedN} linked item(s) against GitHub: {changedN} changed, {missingN} issue(s) not found.</p>}
      {c?.state !== "connected" && <p className="muted">GitHub is not connected. <Link href="/settings/integrations/github">Connect and configure</Link> it first; the sync log fills once it is.</p>}
      {c?.state === "connected" && (
        <div className="card stack">
          <h2>Sync</h2>
          <p className="muted">
            {linkedCount ?? 0} initiative(s) are linked to a GitHub issue. When one of those issues is closed, closed as not planned or reopened, GitHub tells the app and the initiative&rsquo;s Build Status follows
            (Done, Cancelled, Not started). A daily check repairs anything missed.
          </p>
          <p className="muted" role="status">
            Live updates: {(() => { const last = events.find((e) => e.source !== "reconcile"); return last ? `on, last event from GitHub ${new Date(last.received_at).toLocaleString("en-GB")}` : "on (the GitHub App sends them); none received yet"; })()}.
          </p>
          {isAdmin && (
            <div className="row-form">
              <RefreshButton label="Refresh the list" />
              <form action={checkGithubNow}><button className="btn" type="submit">Check GitHub now</button></form>
            </div>
          )}
          {c.last_check_at && <p className="muted" role="status">Last check {new Date(c.last_check_at).toLocaleString("en-GB")}: {c.last_check_summary}</p>}
          {isAdmin && c.installation_id !== null && <p className="muted">Connection test: <Link href="/settings/integrations/github/test">open the latest connection test</Link>.</p>}
          {isAdmin && status === "started" && <AutoRefresh everyMs={3000} maxTries={30} />}
          {isAdmin && (
            <table className="table">
              <caption className="visually-hidden">Latest changes from GitHub</caption>
              <thead><tr><th scope="col">When</th><th scope="col">Issue</th><th scope="col">What happened</th><th scope="col">Result</th><th scope="col"><span className="visually-hidden">Retry</span></th></tr></thead>
              <tbody>
                {events.length === 0 && <tr><td colSpan={5} className="muted">Nothing yet. Close or reopen a linked issue on GitHub, or press &ldquo;Check GitHub now&rdquo;.</td></tr>}
                {events.map((e) => (
                  <tr key={e.id}>
                    <td>{new Date(e.received_at).toLocaleString()}</td>
                    <td>{e.repo_full_name ? `${e.repo_full_name}#${e.issue_number}` : "-"}</td>
                    <td>{e.source === "reconcile" ? "Found by the check" : `GitHub: ${e.action ?? e.event}`}{e.applied && Object.keys(e.applied).length > 0 ? ` · ${Object.entries(e.applied).map(([k, v]) => `${k}: ${String(v[0] ?? "none")} → ${String(v[1])}`).join(", ")}` : ""}</td>
                    <td>{e.state === "error" ? `Failed: ${e.last_error ?? "unknown"} (${e.attempts} tr${e.attempts === 1 ? "y" : "ies"})` : e.state === "processed" ? "Applied" : e.state}</td>
                    <td>{e.state === "error" && <form action={retrySyncEvent.bind(null, e.id)}><button className="btn" type="submit">Run again</button></form>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
