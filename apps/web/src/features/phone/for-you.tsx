"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { attentionList, filterQueue, isPlaceholder, stageMissing, type GateId, type GateRequest } from "@pv/domain";
import { createClient } from "@/lib/supabase/browser";
import { SupabaseGateSource } from "../gates/gate-source";
import type { PortfolioController } from "../portfolio/controller";
import { useWorkspaceController } from "../portfolio/portfolio-client";
import { useStatus } from "../portfolio/status-strip";
import type { Lookups } from "../portfolio/types";

export function ForYouClient({ tenantId, role, userId, lookups }: { tenantId: string; role: string; userId: string; lookups: Lookups }) {
  const { state, retry } = useWorkspaceController(tenantId, role, lookups, userId);
  const gates = useMemo(() => new SupabaseGateSource(createClient(), tenantId), [tenantId]);
  if (state.kind === "loading") return <><div className="page-head"><h1>For you</h1></div><p role="status" className="muted">Loading…</p></>;
  if (state.kind === "error") return <div role="alert" className="error">Could not load the roadmap: {state.message} <button type="button" className="link-button" onClick={retry}>Try again</button></div>;
  return <ForYou controller={state.controller} me={userId} tenantId={tenantId} lookups={lookups} source={gates} />;
}

type Source = Pick<SupabaseGateSource, "loadRequests" | "myGates" | "loadOpenConditions">;

/** What needs this person now: gates waiting for them, what needs attention, and the placeholders they started (docs/29-MOBILE.md section 4.1). */
export function ForYou({ controller, me, tenantId, lookups, source }: { controller: PortfolioController; me: string; tenantId: string; lookups: Lookups; source: Source }) {
  const status = useStatus(controller);
  const [requests, setRequests] = useState<GateRequest[]>([]);
  const [can, setCan] = useState<GateId[]>([]);
  const [conditions, setConditions] = useState<{ item_id: string; text: string }[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    Promise.all([source.loadRequests(), source.myGates(), source.loadOpenConditions()]).then(
      ([r, g, c]) => { if (!off) { setRequests(r); setCan(g); setConditions(c); } },
      (e: Error) => { if (!off) setLoadError(e.message); },
    );
    return () => { off = true; };
  }, [source]);

  const today = controller.todayDate();
  const href = (code: string) => `/w/${tenantId}/portfolio/${encodeURIComponent(code)}`;
  const view = useMemo(() => {
    const rows = controller.rows;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const waiting = filterQueue(requests, "can-decide", me, can).map((r) => ({ req: r, row: byId.get(r.item_id) })).filter((x) => x.row);
    const attention = attentionList(rows, today, { requests, conditions }).slice(0, 5);
    const placeholders = rows.filter((r) => r._created_by === me && isPlaceholder(r)).sort((a, b) => b.stack_rank - a.stack_rank);
    return { waiting, attention, placeholders };
    // the controller changes its rows in place; the version says when
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, status.version, requests, can, conditions, me]);

  return (
    <div className="page-narrow stack for-you">
      <h1>For you</h1>
      {loadError && <p role="alert" className="pf-error">Could not load gate requests: {loadError}</p>}

      <section aria-labelledby="fy-wait">
        <h2 id="fy-wait" className="fy-h">Waiting for my decision ({view.waiting.length})</h2>
        {view.waiting.length === 0 ? <p className="muted">Nothing is waiting for you.</p> : (
          <ul className="phone-cards">
            {view.waiting.map(({ req, row }) => (
              <li key={req.id}><Link className="phone-card" href={`/w/${tenantId}/decisions`}>
                <span className="phone-card-top"><span className="mono">{row!.item_code}</span><span className="phone-health">Gate {req.gate}</span></span>
                <span className="phone-card-name">{row!.initiative_name}</span>
                <span className="muted phone-card-meta">{req.ready ? "Checklist complete" : "Checklist incomplete"}</span>
              </Link></li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="fy-attn">
        <h2 id="fy-attn" className="fy-h">Needs attention</h2>
        {view.attention.length === 0 ? <p className="muted">Nothing needs attention.</p> : (
          <ul className="phone-cards">
            {view.attention.map((e) => (
              <li key={e.id}><Link className="phone-card" href={href(e.code)}>
                <span className="phone-card-top"><span className="mono">#{e.rank} · {e.code}</span></span>
                <span className="phone-card-name">{e.name}</span>
                <span className="muted phone-card-meta">{e.reasons.map((r) => r.text).join(" · ")}</span>
              </Link></li>
            ))}
          </ul>
        )}
        <p><Link href={`/w/${tenantId}/attention`}>See everything that needs attention</Link></p>
      </section>

      <section aria-labelledby="fy-ph">
        <h2 id="fy-ph" className="fy-h">My placeholders ({view.placeholders.length})</h2>
        {view.placeholders.length === 0 ? <p className="muted">Initiatives you add and leave unfinished wait here until they have what their stage needs.</p> : (
          <ul className="phone-cards">
            {view.placeholders.slice(0, 20).map((r) => (
              <li key={r.id}><Link className="phone-card" href={href(r.item_code)}>
                <span className="phone-card-top"><span className="mono">{r.item_code}</span></span>
                <span className="phone-card-name">{r.initiative_name}</span>
                <span className="muted phone-card-meta">Missing: {stageMissing(r).join(", ")}</span>
              </Link></li>
            ))}
          </ul>
        )}
      </section>
      {lookups.projects.length === 0 && <p className="notice-box">There are no projects yet. Ask an admin to add the first one.</p>}
    </div>
  );
}
