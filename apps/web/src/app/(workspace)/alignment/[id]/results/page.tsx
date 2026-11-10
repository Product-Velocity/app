import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/session";
import { computeResults, finalResults, teamPlaces, type ResultsSnapshot } from "@/lib/alignment-results";
import { createAdminClient } from "@/lib/supabase/admin";
import { METHODS } from "@/lib/alignment";
import { RANK_STATUS } from "@/lib/alignment-rank";
import { loadSuggestion } from "@/lib/alignment-rank-server";
import { SuggestedOrder } from "./suggested-order";
import { applyVote, undoVote } from "./actions";

export const metadata = { title: "Alignment results · Product Velocity" };
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ResultsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string }> }) {
  const { id } = await params;
  const { status } = await searchParams;
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
  // the order the vote suggests for the Stack Rank, and what was applied before (closed sessions only; admins only, as the whole page is)
  const suggestion = final ? await loadSuggestion(supabase, active.tenantId, id, snap) : null;
  const { data: applied } = final
    ? await supabase.from("alignment_rank_applications").select("id, created_at, created_by, moved, scope, undone_at").eq("tenant_id", active.tenantId).eq("session_id", id).order("created_at", { ascending: false })
    : { data: [] };
  const applications = (applied ?? []) as { id: string; created_at: string; created_by: string | null; moved: number; scope: string; undone_at: string | null }[];
  // why each application differs from the vote (admins only: the table is not readable by anyone else), with the initiatives' codes
  const { data: reasonRows } = applications.length > 0
    ? await supabase.from("alignment_rank_reasons").select("application_id, item_id, from_rank, to_rank, crowd_rank, reason").eq("tenant_id", active.tenantId).in("application_id", applications.map((a) => a.id)).order("to_rank")
    : { data: [] };
  const reasons = (reasonRows ?? []) as { application_id: string; item_id: string; from_rank: number; to_rank: number; crowd_rank: number; reason: string }[];
  const { data: reasonItems } = reasons.length > 0
    ? await supabase.from("items").select("id, item_code, initiative_name").eq("tenant_id", active.tenantId).in("id", [...new Set(reasons.map((r) => r.item_id))])
    : { data: [] };
  const itemName = new Map(((reasonItems ?? []) as { id: string; item_code: string; initiative_name: string }[]).map((i) => [i.id, `${i.item_code} ${i.initiative_name}`]));
  const who = new Map(((await supabase.rpc("tenant_directory", { p_tenant: active.tenantId })).data as { user_id: string; email: string }[] | null ?? []).map((m) => [m.user_id, m.email]));
  const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="page-wide">
      <p><Link href={`/alignment/${id}`}>← {s.name}</Link></p>
      <h1>Results</h1>
      <p><strong>{final ? "Final results" : "Provisional: the session is still open"}</strong> · {method.label} · {s.weighting === "equal" ? "groups count equally" : "groups count by headcount"}</p>
      <p>{snap.voters} of {snap.invited} invited {snap.invited === 1 ? "person has" : "people have"} voted{final ? "" : ", and a vote can still change"}. {final ? `Stored ${new Date(snap.computedAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}; it does not change.` : ""}</p>
      {status && RANK_STATUS[status] && <p role="status" className="notice">{RANK_STATUS[status]}</p>}
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
      {suggestion && (
        <section aria-labelledby="suggested-order">
          <h2 id="suggested-order">Order for the Stack Rank</h2>
          <p className="muted">The vote is advice. A person decides: nothing changes until you apply it, and Claude can never apply it.</p>
          <SuggestedOrder sessionId={id} rows={suggestion.rows} skipped={suggestion.skipped} apply={applyVote} />
          {applications.length > 0 && (
            <>
              <h3>Applied before</h3>
              <ul>
                {applications.map((a) => (
                  <li key={a.id}>
                    {when(a.created_at)} by {a.created_by ? who.get(a.created_by) ?? "a member" : "the system"}: {a.moved} {a.moved === 1 ? "initiative" : "initiatives"} moved ({a.scope === "all" ? "all of the vote" : "a selection"}).{" "}
                    {reasons.some((r) => r.application_id === a.id) && (
                      <ul>
                        {reasons.filter((r) => r.application_id === a.id).map((r) => (
                          <li key={r.item_id}><strong>{itemName.get(r.item_id) ?? "An initiative"}</strong>: the vote suggested #{r.crowd_rank}, decided #{r.to_rank}. Reason: {r.reason}</li>
                        ))}
                      </ul>
                    )}
                    {a.undone_at ? <span className="muted">Undone {when(a.undone_at)}.</span> : (
                      <form action={undoVote} className="inline-form">
                        <input type="hidden" name="session" value={id} /><input type="hidden" name="application" value={a.id} />
                        <button type="submit" className="btn btn-link">Undo this change</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      <div className="row-form">
        <Link className="btn" href={`/alignment/${id}/results/export`} prefetch={false}>Export results (CSV)</Link>
        <Link className="btn" href={`/alignment/${id}/names`}>Show who voted what…</Link>
      </div>
    </div>
  );
}
