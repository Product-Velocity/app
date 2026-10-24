import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/session";
import { CONSENT_LINES, METHODS, NEXT_STATE, STATE_LABEL, type Group, type SessionState } from "@/lib/alignment";
import { changeState } from "../actions";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Alignment session · Product Velocity" };

const NOTICE: Record<string, string> = {
  open: "The session is open. Its settings are now locked.", closed: "The session is closed.", archived: "The session is archived.",
  failed: "We could not change the state.", "not-allowed": "Only admins can change a session.",
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
      {state === "open" && <p className="muted">Participants and invitations arrive with the next release; until then an open session has no voters.</p>}
    </div>
  );
}
