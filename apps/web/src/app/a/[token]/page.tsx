import { CONSENT_LINES, METHODS } from "@/lib/alignment";
import { resolveLink, sameBrowser } from "@/lib/alignment-link";
import { createAdminClient } from "@/lib/supabase/admin";
import { finalResults } from "@/lib/alignment-results";
import { cleanProgress, type BallotItem, type Method } from "@/lib/alignment-ballot";
import { Ballot } from "./ballot";
import { LinkButton } from "./join-form";

export const metadata = { title: "Your vote · Product Velocity", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <div className="card auth-card stack">
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}

/** The page behind a participant's personal link: no account, no sign-in. */
export default async function ParticipantPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await resolveLink(token);

  if (link.kind === "unknown") {
    return (
      <Shell title="This link is not valid">
        <p className="muted">The link may be mistyped, or the invitation was withdrawn. Ask the person who invited you to send it again.</p>
      </Shell>
    );
  }
  if (link.kind === "replaced") {
    return (
      <Shell title="A newer link was sent to you">
        <p>Use the most recent email you received for this session. If you cannot find it, we can send a new link to the address you were invited on.</p>
        <LinkButton token={token} action="new" label="Email me a new link" />
      </Shell>
    );
  }

  const { participant: p, session: s } = link;
  if (s.status === "draft") return <Shell title={s.name}><p>This session has not opened yet. Try again when you get the invitation.</p></Shell>;
  if (s.status !== "open") {
    // after the close: the anonymous results, only if the admin allowed it, and only to the browser the link belongs to
    const snap = s.show_results && p.consent_at && (await sameBrowser(p)) ? await finalResults(s.id) : null;
    if (!snap) {
      return (
        <Shell title={s.name}>
          <p>This session is closed. Thank you for taking part.</p>
          {s.show_results && <p className="muted">The anonymous results are shown to the browser where you opened your link.</p>}
        </Shell>
      );
    }
    const admin = createAdminClient({ via: "system" });
    const { data: ballot } = await admin.rpc("alignment_ballot_get", { p_participant: p.id });
    const bid = (ballot as { ballot_id: string }[] | null)?.[0]?.ballot_id;
    const { data: mineRows } = bid ? await admin.from("alignment_votes").select("alignment_item_id, rank, coins, impact, confidence, ease").eq("ballot_id", bid) : { data: [] };
    const mine = new Map(((mineRows ?? []) as { alignment_item_id: string; rank: number | null; coins: number | null; impact: number | null; confidence: number | null; ease: number | null }[]).map((v) => [v.alignment_item_id, v]));
    const names = new Map(snap.items.map((i) => [i.id, i.name]));
    const yours = (id: string) => { const v = mine.get(id); if (!v) return ""; if (v.rank) return `Your place: ${v.rank}`; if (v.coins) return `Your coins: ${v.coins}`; return v.impact ? `Your scores: ${v.impact} / ${v.confidence} / ${v.ease}` : ""; };
    return (
      <main className="auth-page">
        <div className="card auth-card stack ballot-shell">
          <h1>{s.name}: results</h1>
          <p className="muted">What {snap.voters} {snap.voters === 1 ? "person" : "people"} decided. These results are anonymous.</p>
          <ol className="plain-list">
            {snap.results.joint.map((r) => (
              <li key={r.itemId}>
                <strong>{r.tied ? "= " : ""}{r.place}. {names.get(r.itemId)}</strong> · {r.score.toFixed(0)} / 100
                {yours(r.itemId) && <span className="muted"> · {yours(r.itemId)}</span>}
              </li>
            ))}
          </ol>
          <p className="muted">Equal scores share a place.</p>
        </div>
      </main>
    );
  }

  const mine = await sameBrowser(p);
  if (p.browser_hash && !mine) {
    return (
      <Shell title="This link was opened in another browser">
        <p>For your privacy a personal link works in the browser where it was first opened. To continue here, we can send you a new link; it replaces the old one.</p>
        <LinkButton token={token} action="new" label="Email me a new link" />
      </Shell>
    );
  }

  if (!mine) {
    const method = METHODS.find((m) => m.value === s.method)!;
    return (
      <Shell title={s.name}>
        <p><strong>{method.label}.</strong> {method.help}</p>
        <div className="notice">
          <p><strong>Before you start</strong></p>
          <ul>
            {CONSENT_LINES.map((l) => <li key={l}>{l}</li>)}
            <li>Your personal data is kept for {s.retention_months} months after the session closes.</li>
          </ul>
        </div>
        <p className="muted">By continuing you agree to this. To have your data removed, ask the person who invited you.</p>
        <LinkButton token={token} action="join" label="I agree, continue" refresh />
      </Shell>
    );
  }

  const admin = createAdminClient({ via: "system" });
  const { data: rows } = await admin.from("alignment_items").select("id, shown_name, shown_summary, shown_value_proposition").eq("session_id", s.id).order("position");
  const items: BallotItem[] = ((rows ?? []) as { id: string; shown_name: string | null; shown_summary: string | null; shown_value_proposition: string | null }[]).map((r) => ({ id: r.id, name: r.shown_name ?? "Initiative", summary: r.shown_summary, value: r.shown_value_proposition }));
  const { data: ballot } = await admin.rpc("alignment_ballot_get", { p_participant: p.id });
  const b = (ballot as { state: string; progress: unknown; revision: number }[] | null)?.[0];
  const method = METHODS.find((m) => m.value === s.method)!;
  return (
    <main className="auth-page">
      <div className="card auth-card stack ballot-shell">
        <h1>{s.name}</h1>
        <p className="muted"><strong>{method.label}.</strong> {method.help}{s.method === "coins" ? ` You have ${s.coins_total} coins, at most ${s.coins_max_per_item} on one initiative.` : ""}</p>
        <Ballot
          token={token}
          method={s.method as Method}
          items={items}
          coinsTotal={s.coins_total}
          coinsMax={s.coins_max_per_item}
          initial={cleanProgress(b?.progress, items)}
          initialRevision={b?.revision ?? 0}
          submitted={b?.state === "submitted"}
          closesAt={s.closes_at}
        />
      </div>
    </main>
  );
}
