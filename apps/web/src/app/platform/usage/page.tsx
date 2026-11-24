import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/session";

export const metadata = { title: "Usage · Platform · Product Velocity" };

type Row = { tenant_id: string; tenant_name: string; people: number | string; changes: number | string; last_change: string | null };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "None");

/**
 * Usage per workspace for the last 30 days (issue #634): how many different people made a change and how many changes were made, from the
 * audit log. Counts only, per workspace. There is no list of people and no ranking of them (rule 8: no individual metrics).
 */
export default async function PlatformUsagePage() {
  const { supabase } = await requirePlatformAdmin("/platform/usage");
  const { data } = await supabase.rpc("platform_usage_stats", { p_days: 30 });
  const rows = (data ?? []) as Row[];
  return (
    <div className="page-wide">
      <h1>Usage</h1>
      <p className="muted">
        The last 30 days in each workspace: how many different people made a change, how many changes were made, and when the last one was. These are team
        numbers read from the audit log. They never name a person. Reading, signing in and AI-assistant reads are not counted here; see All accounts for the last sign-in.
      </p>
      <div className="table-wrap">
        <table className="data-table" data-testid="usage-table">
          <caption className="visually-hidden">Usage per workspace, last 30 days</caption>
          <thead>
            <tr>
              <th scope="col">Workspace</th>
              <th scope="col">People who made a change</th>
              <th scope="col">Changes</th>
              <th scope="col">Last change</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={4}>No workspaces yet.</td></tr>}
            {rows.map((r) => (
              <tr key={r.tenant_id}>
                <td><Link href="/platform">{r.tenant_name}</Link></td>
                <td>{Number(r.people)}</td>
                <td>{Number(r.changes)}</td>
                <td>{when(r.last_change)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
