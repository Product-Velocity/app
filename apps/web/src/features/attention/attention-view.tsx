"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ATTENTION_KINDS, attentionCounts, attentionList, filterAttention, type AttentionAction, type AttentionEntry, type AttentionKind, type GateRequest } from "@pv/domain";
import type { PortfolioController } from "../portfolio/controller";
import type { Lookups } from "../portfolio/types";
import { useViewRows } from "../portfolio/use-view-rows";
import { RequestGateDialog } from "../gates/gate-dialogs";
import type { GateSource } from "../gates/gate-source";

type Props = { controller: PortfolioController; lookups: Lookups; me: string | null; source: GateSource; pageHref?: (code: string) => string; decisionsHref?: string };

/**
 * The Needs attention screen (issue #337): what has to be looked at, why, how long, and the next step in one click. Rules live in `attentionList`
 * (packages/domain/src/attention.ts). A mismatch is a suggestion: the buttons move or request through the same gate functions as everywhere else.
 */
export function AttentionView({ controller, lookups, me, source, pageHref = (c) => `/portfolio/${encodeURIComponent(c)}`, decisionsHref = "/decisions" }: Props) {
  const router = useRouter();
  const { rows } = useViewRows(controller, me);
  const today = controller.todayDate();
  const [requests, setRequests] = useState<GateRequest[]>([]);
  const [conditions, setConditions] = useState<{ item_id: string; text: string }[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<AttentionKind | "all">("all");
  const [active, setActive] = useState<string | null>(null);
  const [gateFor, setGateFor] = useState<{ id: string; gate: string } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let off = false;
    Promise.all([source.loadRequests(), source.loadOpenConditions()]).then(
      ([r, c]) => { if (!off) { setRequests(r); setConditions(c); setLoadError(null); } },
      (e: Error) => { if (!off) setLoadError(e.message); },
    );
    return () => { off = true; };
  }, [source, reload]);

  const entries = useMemo(() => attentionList(rows, today, { requests, conditions }), [rows, today, requests, conditions]);
  const counts = useMemo(() => attentionCounts(entries), [entries]);
  const shown = useMemo(() => filterAttention(entries, kind), [entries, kind]);

  const changed = useCallback(() => { void controller.refreshFromServer(); setReload((n) => n + 1); }, [controller]);

  const run = async (e: AttentionEntry, a: AttentionAction) => {
    setMessage(null);
    if (a.type === "decisions") { router.push(decisionsHref); return; }
    if (a.type === "request-gate") { setGateFor({ id: e.id, gate: a.gate }); return; }
    setBusy(e.id);
    const r = await source.move(e.id, a.to);
    setBusy(null);
    if (r.ok) { setMessage({ ok: true, text: `${e.code} moved to ${a.to}.` }); changed(); } else setMessage({ ok: false, text: `${e.code} was not moved: ${r.error}` });
  };

  // J and K walk the list, Enter opens the initiative
  useEffect(() => {
    const h = (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey || gateFor) return;
      if ((ev.target as HTMLElement).closest("input, textarea, select, button, a, [role=dialog]")) return;
      const i = shown.findIndex((x) => x.id === active);
      if (ev.key === "j" || ev.key === "ArrowDown") { ev.preventDefault(); setActive(shown[Math.min(shown.length - 1, i + 1)]?.id ?? null); }
      else if (ev.key === "k" || ev.key === "ArrowUp") { ev.preventDefault(); setActive(shown[Math.max(0, i - 1)]?.id ?? null); }
      else if (ev.key === "Enter" && i >= 0) { ev.preventDefault(); router.push(pageHref(shown[i]!.code)); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [shown, active, gateFor, router, pageHref]);

  const gateItem = gateFor ? controller.row(gateFor.id) : null;

  return (
    <div className="attention">
      <div className="page-head">
        <h1>Needs attention</h1>
        <p className="muted">What to look at in the initiatives you can see, why, and the next step. These are suggestions: nothing changes until you press a button.</p>
      </div>
      <div className="help-tabs" role="tablist" aria-label="Filter by reason">
        <button type="button" role="tab" aria-selected={kind === "all"} className={`help-tab${kind === "all" ? " is-active" : ""}`} onClick={() => setKind("all")}>All ({entries.length})</button>
        {ATTENTION_KINDS.map((k) => (
          <button key={k.id} type="button" role="tab" aria-selected={kind === k.id} className={`help-tab${kind === k.id ? " is-active" : ""}`} title={k.hint} onClick={() => setKind(k.id)}>{k.label} ({counts[k.id]})</button>
        ))}
      </div>
      {loadError && <p role="alert" className="error">Gate requests and conditions could not be read ({loadError}); the other reasons are still shown.</p>}
      {message && <p role={message.ok ? "status" : "alert"} className={message.ok ? "quick-add-ok" : "error"}>{message.text}</p>}
      {shown.length === 0 ? (
        <p className="muted" role="status">{entries.length === 0 ? "Nothing needs attention." : "Nothing in this group."}</p>
      ) : (
        <ul className="attention-list" aria-label="Initiatives that need attention">
          {shown.map((e) => (
            <li key={e.id} className={`attention-item${e.id === active ? " is-active" : ""}`} onClick={() => setActive(e.id)} aria-current={e.id === active ? "true" : undefined}>
              <div className="attention-head">
                <a className="attention-name" href={pageHref(e.code)}><span className="mono">{e.code}</span> {e.name}</a>
                <span className="muted attention-tier">{e.tier === 0 ? "Urgent" : e.tier === 1 ? "Soon" : "Look at it"}</span>
              </div>
              <ul className="attention-reasons">
                {e.reasons.filter((r) => kind === "all" || r.kind === kind).map((r, i) => (
                  <li key={i}>
                    <span className="pill attention-kind">{ATTENTION_KINDS.find((k) => k.id === r.kind)!.label}</span> {r.text}
                    {r.action && <> <button type="button" className="btn" disabled={busy === e.id} onClick={() => void run(e, r.action!)}>{busy === e.id ? "Moving…" : r.action.label}</button></>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <p className="muted">J and K move through the list, Enter opens the initiative. Time in a phase is for the initiative, never for a person.</p>
      {gateFor && gateItem && <RequestGateDialog source={source} items={[gateItem as never]} onClose={() => setGateFor(null)} onDone={changed} />}
    </div>
  );
}
