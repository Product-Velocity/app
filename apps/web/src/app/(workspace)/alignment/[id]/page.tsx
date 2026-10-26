import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/session";
import { CONSENT_LINES, METHODS, NEXT_STATE, STATE_LABEL, type Group, type SessionState } from "@/lib/alignment";
import { participantState, MAILING_STATE_LABEL } from "@/lib/alignment-mail";
import { changeState, removeParticipant, startMailing } from "../actions";
import { ParticipantsForm } from "./participants-form";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Alignment session · Product Velocity" };

const NOTICE: Record<string, string> = {
  open: "The session is open. Its settings are now locked.", closed: "The session is closed.", archived: "The session is archived.",
  failed: "We could not change the state.", "not-allowed": "Only admins can change a session.",
  "person-removed": "The person's personal data was cleared.", "mailing-cancelled": "The mailing was cancelled.",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AlignmentSessionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string }> }) {
  const { id } = await params;
  const { status } = await searchParams;
  if (!UUID.test(id)) notFound();
  const { supabase, active } = await requireWorkspace(`/alignment/${id}`);
  await supabase.rpc("alignment_close_due", { p_tenant: active.tenantId });
  const { data: s } = await supabase.from("alignment_sessions").select("*").eq("tenant_id", active.tenantId).eq("id", id).maybeSingle();
  if (!s) notFound();
  const { data: itemRows } = await supabase.from("alignment_items").select("item_id, position, shown_name, shown_summary, shown_value_proposition, snapshot_at").eq("tenant_id", active.tenantId).eq("session_id", id).order("position");
  const items = (itemRows ?? []) as { item_id: string | null; position: number; shown_name: string | null; shown_summary: string | null; shown_value_proposition: string | null; snapshot_at: string | null }[];
  // before the session opens the preview reads the initiatives live (customer-safe fields only); after, it shows the frozen snapshot
  let shown = items.map((i) => ({ name: i.shown_name, summary: i.shown_summary, value: i.shown_value_proposition, id: i.item_id }));
  if (s.status === "draft" && items.length > 0) {
    const { data: live } = await supabase.from("items").select("id, initiative_name, summary, value_proposition").eq("tenant_id", active.tenantId).in("id", items.map((i) => i.item_id).filter((x): x is string => !!x));
    const by = new Map(((live ?? []) as { id: string; initiative_name: string; summary: string | null; value_proposition: string | null }[]).map((r) => [r.id, r]));
    shown = items.map((i) => { const r = i.item_id ? by.get(i.item_id) : undefined; return { id: i.item_id, name: r?.initiative_name ?? null, summary: r?.summary ?? null, value: r?.value_proposition ?? null }; });
  }
  const state = s.status as SessionState;
  const method = METHODS.find((m) => m.value === s.method)!;
  const next = NEXT_STATE[state];
  const isAdmin = active.role === "admin";
  const groups = s.groups as Group[];
  type Person = { id: string; email: string | null; name: string | null; group_id: string; invited_at: string | null; email_status: string; email_error: string | null; consent_at: string | null; unsubscribed_at: string | null; removed_at: string | null; voted: boolean };
  let people: Person[] = [];
  let mailings: { id: string; kind: string; status: string; sent_count: number; failed_count: number; created_at: string }[] = [];
  if (isAdmin) {
    const { data } = await supabase.rpc("alignment_participants_list", { p_session: id });
    people = (data ?? []) as Person[];
    const { data: ml } = await supabase.from("alignment_mailings").select("id, kind, status, sent_count, failed_count, created_at").eq("tenant_id", active.tenantId).eq("session_id", id).order("created_at", { ascending: false }).limit(20);
    mailings = (ml ?? []) as typeof mailings;
  }
  const groupName = (gid: string) => groups.find((g) => g.id === gid)?.name ?? gid;
  const active_ = people.filter((p) => !p.removed_at);
  const count = (f: (p: Person) => boolean) => active_.filter(f).length;

  return (
    <div className="page-narrow">
      <p><Link href="/alignment">← All sessions</Link></p>
      <h1>{s.name}</h1>
      <p><strong>{STATE_LABEL[state]}</strong> · {method.label} · {items.length} initiatives</p>
      {status && NOTICE[status] && <p role="status" className="notice">{NOTICE[status]}</p>}
      {status && !NOTICE[status] && <p role="alert" className="error">{decodeURIComponent(status)}</p>}

      <h2>Settings</h2>
      <div className="card">
        {state !== "draft" && <p className="muted">The settings of a session that has opened are locked. Make a new session to change them.</p>}
        <SettingsForm
          locked={state !== "draft" || !isAdmin}
          session={{ id: s.id, name: s.name, method: s.method, groups, weighting: s.weighting, excluded: s.excluded_groups, coinsTotal: s.coins_total, coinsMax: s.coins_max_per_item, showResults: s.show_results, retention: s.retention_months, closesAt: s.closes_at }}
        />
      </div>

      <h2>Preview as a participant</h2>
      <div className="card stack" aria-label="Participant preview">
        <p className="muted">This is what a participant sees. {state === "draft" ? "It reads the initiatives as they are now; opening the session fixes it." : "It shows the fixed copy taken when the session opened."} Commercial fields are never shown.</p>
        <div className="notice">
          <p><strong>Before you start</strong></p>
          <ul>{CONSENT_LINES.map((l) => <li key={l}>{l}</li>)}<li>Your personal data is kept for {s.retention_months} months after the session closes.</li></ul>
        </div>
        <p><strong>{method.label}.</strong> {method.help}{s.method === "coins" ? ` You have ${s.coins_total} coins, at most ${s.coins_max_per_item} on one initiative.` : ""}</p>
        <ol className="plain-list">
          {shown.map((i, n) => (
            <li key={i.id ?? n}>
              <strong>{i.name ?? "Initiative"}</strong>
              {i.summary && <p>{i.summary}</p>}
              {i.value && <p className="muted">{i.value}</p>}
            </li>
          ))}
        </ol>
        <p className="muted">Groups: {groups.map((g) => g.name).join(", ")} · {s.show_results ? "Participants see the anonymous results after the session closes." : "Participants do not see results."}</p>
      </div>

      {isAdmin && state !== "archived" && (
        <>
          <h2>Participants</h2>
          <div className="card stack">
            <p>
              <strong>{active_.length}</strong> {active_.length === 1 ? "person" : "people"} · {count((p) => !!p.invited_at)} invited · {count((p) => !!p.consent_at)} joined · {count((p) => p.voted)} voted
              {count((p) => ["bounced", "complained", "failed"].includes(p.email_status)) > 0 && ` · ${count((p) => ["bounced", "complained", "failed"].includes(p.email_status))} not reachable`}
            </p>
            <p className="muted">Only admins see this list. It shows who voted, never what they answered; opening names is a separate, logged action. Participants see the anonymous results at most.</p>
            {state !== "closed" && <ParticipantsForm sessionId={s.id} groups={groups} />}
            {people.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <caption className="sr-only">Participants</caption>
                  <thead><tr><th scope="col">Person</th><th scope="col">Group</th><th scope="col">State</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {people.map((p) => {
                      const st = participantState(p);
                      return (
                        <tr key={p.id}>
                          <td>{p.removed_at ? <span className="muted">Removed</span> : <>{p.name ? <strong>{p.name}</strong> : null}{p.name ? " " : ""}<span className={p.name ? "muted" : ""}>{p.email}</span></>}</td>
                          <td>{groupName(p.group_id)}</td>
                          <td>{st.label}{p.unsubscribed_at ? " · no reminders" : ""}</td>
                          <td>
                            {!p.removed_at && (
                              <form action={removeParticipant}>
                                <input type="hidden" name="id" value={p.id} /><input type="hidden" name="session" value={s.id} />
                                <button className="btn btn-link" type="submit" aria-label={`Clear the personal data of ${p.name ?? p.email}`}>Remove</button>
                              </form>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {state !== "closed" && active_.length > 0 && (
              <div className="row-form">
                <form action={startMailing}>
                  <input type="hidden" name="session" value={s.id} /><input type="hidden" name="kind" value="invitation" />
                  <button className="btn btn-primary" type="submit" disabled={count((p) => !p.invited_at && !["bounced", "complained"].includes(p.email_status)) === 0}>Write the invitation…</button>
                </form>
                <form action={startMailing}>
                  <input type="hidden" name="session" value={s.id} /><input type="hidden" name="kind" value="reminder" />
                  <button className="btn" type="submit" disabled={count((p) => !!p.invited_at && !p.voted && !p.unsubscribed_at) === 0}>Remind people who have not voted…</button>
                </form>
              </div>
            )}
            {state === "draft" && active_.length > 0 && <p className="muted">You can write the invitation now. It can be sent once the session is open.</p>}
            {mailings.length > 0 && (
              <>
                <h3>Mailings</h3>
                <ul className="plain-list">
                  {mailings.map((m) => (
                    <li key={m.id}><Link href={`/alignment/${s.id}/mail/${m.id}`}>{m.kind === "invitation" ? "Invitation" : "Reminder"}</Link> · {MAILING_STATE_LABEL[m.status] ?? m.status}{m.status !== "draft" && m.status !== "cancelled" ? ` · ${m.sent_count} sent${m.failed_count ? `, ${m.failed_count} not sent` : ""}` : ""}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </>
      )}

      {isAdmin && next && (
        <>
          <h2>{next.label}</h2>
          <form action={changeState} className="card stack">
            <p>{next.confirm}</p>
            <input type="hidden" name="id" value={s.id} />
            <input type="hidden" name="to" value={next.to} />
            <div><button className="btn btn-primary" type="submit">{next.label}</button></div>
          </form>
        </>
      )}
    </div>
  );
}
