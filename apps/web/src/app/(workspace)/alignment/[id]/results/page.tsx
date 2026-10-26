import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/session";
import { computeResults, finalResults, teamPlaces, type ResultsSnapshot } from "@/lib/alignment-results";
import { createAdminClient } from "@/lib/supabase/admin";
import { METHODS } from "@/lib/alignment";

export const metadata = { title: "Alignment results · Product Velocity" };
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { supabase, active } = await requireWorkspace(`/alignment/${id}/results`);
  if (active.role !== "admin") notFound();
  await supabase.rpc("alignment_close_due", { p_tenant: active.tenantId });
  const { data: s } = await supabase.from("alignment_sessions").select("id, name, status, method, weighting, closes_at").eq("tenant_id", active.tenantId).eq("id", id).maybeSingle();
  if (!s) notFound();
  if (s.status === "draft") {
    return <div className="page-narrow"><p><Link href={`/alignment/${id}`}>← {s.name}</Link></p><h1>Results</h1><p className="muted">The session has not opened yet.</p></div>;
  }
  const final = s.status === "closed" || s.status === "archived";
  // an open session shows a provisional count to admins; a closed one shows the copy stored at the close
  const snap: ResultsSnapshot | null = final ? await finalResults(id) : await computeResults(createAdminClient({ via: "system" }), id);
  if (!snap) notFound();
  const { results: r } = snap;
  const team = await teamPlaces(id);
  const name = new Map(snap.items.map((i) => [i.id, i.name]));
  const contested = new Map(r.contested.map((c) => [c.itemId, c]));
  const method = METHODS.find((m) => m.value === s.method)!;

  return (
    <div className="page-wide">
      <p><Link href={`/alignment/${id}`}>← {s.name}</Link></p>
      <h1>Results</h1>
      <p><strong>{final ? "Final results" : "Provisional: the session is still open"}</strong> · {method.label} · {s.weighting === "equal" ? "groups count equally" : "groups count by headcount"}</p>
      <p>{snap.voters} of {snap.invited} invited {snap.invited === 1 ? "person has" : "people have"} voted{final ? "" : ", and a vote can still change"}. {final ? `Stored ${new Date(snap.computedAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}; it does not change.` : ""}</p>
      {snap.voters === 0 && <p className="notice">Nobody has voted yet.</p>}
      {r.groupsNote && <p className="notice">{r.groupsNote}</p>}

      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Results by initiative</caption>
          <thead>
            <tr>
              <th scope="col">Crowd</th><th scope="col">Initiative</th><th scope="col">Score (top = 100)</th><th scope="col">Team (Stack Rank)</th><th scope="col">Gap</th>
              {r.groups?.map((g) => <th scope="col" key={g.id}>{g.name} <span className="muted">(n={g.voters})</span></th>)}
              <th scope="col">Note</th>
            </tr>
          </thead>
          <tbody>
            {r.joint.map((p) => {
              const t = team.get(p.itemId);
              const gap = t ? t - p.place : null;
              const c = contested.get(p.itemId);
              return (
                <tr key={p.itemId}>
                  <td>{p.tied ? "=" : ""}{p.place}{p.tied && <span className="sr-only"> (tied)</span>}</td>
                  <td>{name.get(p.itemId)}</td>
                  <td><span className="score-bar" aria-hidden="true"><span style={{ width: `${p.score}%` }} /></span> {p.score.toFixed(1)}</td>
                  <td>{t ?? "–"}</td>
                  <td>{gap === null ? "–" : gap === 0 ? "Same" : gap > 0 ? `▲ crowd ranks it ${gap} higher` : `▼ crowd ranks it ${-gap} lower`}</td>
                  {r.groups?.map((g) => { const x = g.scores.find((z) => z.itemId === p.itemId)!; return <td key={g.id}>{x.tied ? "=" : ""}{x.place}</td>; })}
                  <td>{c ? <strong>Contested: {c.highGroup} high, {c.lowGroup} low</strong> : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted">Equal scores share a place and are shown as tied. Gap compares the crowd&rsquo;s place with the team&rsquo;s Stack Rank among these initiatives. Groups with fewer than 5 voters are never shown on their own. A person applies any change to the Stack Rank; nothing here changes it.</p>
      <div className="row-form">
        <Link className="btn" href={`/alignment/${id}/results/export`} prefetch={false}>Export results (CSV)</Link>
        <Link className="btn" href={`/alignment/${id}/names`}>Show who voted what…</Link>
      </div>
    </div>
  );
}
