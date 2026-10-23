import Link from "next/link";
import { requireWorkspace } from "@/lib/session";
import { METHODS, STATE_LABEL, type SessionState } from "@/lib/alignment";

export const metadata = { title: "Alignment · Product Velocity" };

/** The workspace's alignment sessions (issue #123). Sessions are made from a selection in the roadmap: select initiatives, then "Start alignment session…". */
export default async function AlignmentPage() {
  const { supabase, active } = await requireWorkspace("/alignment");
  await supabase.rpc("alignment_close_due", { p_tenant: active.tenantId }); // sessions past their closing time close now
  const { data: sessions } = await supabase.from("alignment_sessions").select("id, name, method, status, closes_at, created_at").eq("tenant_id", active.tenantId).order("created_at", { ascending: false });
  const { data: counts } = await supabase.from("alignment_items").select("session_id").eq("tenant_id", active.tenantId);
  const perSession = new Map<string, number>();
  for (const c of (counts ?? []) as { session_id: string }[]) perSession.set(c.session_id, (perSession.get(c.session_id) ?? 0) + 1);
  const rows = (sessions ?? []) as { id: string; name: string; method: string; status: SessionState; closes_at: string | null }[];

  return (
    <div className="page-narrow">
      <h1>Alignment</h1>
      <p className="muted">
        Ask a group of people to rank initiatives: the top five with duels, 100 coins, or ICE sliders. Participants need no account and see only anonymous results.
        {active.role === "admin" ? <> To start one, select two or more initiatives in the <Link href="/portfolio">roadmap</Link> and press <strong>Start alignment session…</strong>.</> : " An admin starts sessions."}
      </p>
      {rows.length === 0 ? <p>No alignment sessions yet.</p> : (
        <table className="table">
          <thead><tr><th scope="col">Session</th><th scope="col">Method</th><th scope="col">Initiatives</th><th scope="col">State</th><th scope="col">Closes</th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <th scope="row"><Link href={`/alignment/${s.id}`}>{s.name}</Link></th>
                <td>{METHODS.find((m) => m.value === s.method)?.label ?? s.method}</td>
                <td>{perSession.get(s.id) ?? 0}</td>
                <td>{STATE_LABEL[s.status]}</td>
                <td>{s.closes_at ? new Date(s.closes_at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Closed by hand"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
