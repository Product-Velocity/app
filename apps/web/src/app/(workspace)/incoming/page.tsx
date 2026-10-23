import Link from "next/link";
import { requireWorkspace } from "@/lib/session";
import { IncomingClient } from "@/features/incoming/incoming-client";
import { AutoRefresh } from "../settings/integrations/github/auto-refresh";
import { checkGithubNow } from "../settings/integrations/github/actions";

export const metadata = { title: "Incoming · Product Velocity" };

/** "Check GitHub now" reads every issue of the connected repositories: allow the longest run the plan offers. */
export const maxDuration = 60;

/** Issues in the tracker that are not initiatives: pull in, ignore, and the rules for new arrivals (R-024). */
export default async function IncomingPage({ searchParams }: { searchParams: Promise<{ status?: string; why?: string; t?: string }> }) {
  const { status, why, t } = await searchParams;
  const { supabase, active } = await requireWorkspace("/incoming");
  const { data: conn } = await supabase.from("github_connections").select("id, last_check_at, last_check_summary").eq("tenant_id", active.tenantId).eq("state", "connected").maybeSingle();
  if (!conn) {
    return (
      <>
        <div className="page-head"><h1>Incoming</h1></div>
        <p>This workspace is not connected to GitHub yet. {active.role === "admin" ? <Link href="/settings/integrations/github">Connect GitHub</Link> : "An admin can connect it in Settings > GitHub."}</p>
      </>
    );
  }
  const { data: projects } = await supabase.from("projects").select("id, name").eq("tenant_id", active.tenantId).or("tracker.is.null,tracker.eq.github").order("name");
  const c = conn as { last_check_at: string | null; last_check_summary: string | null };
  // "started" until a check that finished after the click has left its result
  const running = status === "started" && !(c.last_check_at && Date.parse(c.last_check_at) >= Number(t ?? 0));
  return (
    <>
      <div className="incoming-check">
        {active.role === "admin" && (
          <form action={checkGithubNow}>
            <input type="hidden" name="from" value="incoming" />
            <button className="btn" type="submit">Check GitHub now</button>
          </form>
        )}
        <span className="muted" role="status">
          {running ? "Checking GitHub in the background. The list updates by itself when it is done (up to a minute)." : c.last_check_at ? `Last check ${new Date(c.last_check_at).toLocaleString("en-GB")}: ${c.last_check_summary}` : "GitHub has not been checked yet."}
        </span>
        {status === "error" && why && <span role="alert" className="notice">Reason: {why.slice(0, 200)}</span>}
        {running && <AutoRefresh everyMs={3000} maxTries={30} />}
      </div>
      <IncomingClient key={c.last_check_at ?? "none"} tenantId={active.tenantId} projects={(projects ?? []) as { id: string; name: string }[]} canEdit={["creator", "admin"].includes(active.role)} canAdmin={active.role === "admin"} />
    </>
  );
}
