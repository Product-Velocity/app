"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useScope } from "../workspace/scope";
import type { PortfolioController } from "../portfolio/controller";
import { useStatus } from "../portfolio/status-strip";
import type { Lookups } from "../portfolio/types";
import { FIXED_CHIPS, GROUP_LABEL, PHASE_CHIPS, SORT_LABEL, filterPhoneRows, groupPhoneRows, sortPhoneRows, type Group, type PhoneRow, type Sort } from "./phone-list";

const emailName = (e: string) => e.split("@")[0]!.replace(/[._]/g, " ");

/** The Initiatives screen on a phone: sticky search, quick-filter chips and collapsible groups of cards (docs/29-MOBILE.md section 4.2). */
export function PhoneInitiatives({ controller, lookups, me, tenantId }: { controller: PortfolioController; lookups: Lookups; me: string | null; tenantId: string }) {
  const status = useStatus(controller);
  const scope = useScope();
  const [query, setQuery] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>("rank");
  const [group, setGroup] = useState<Group>("phase");
  const [closed, setClosed] = useState<Set<string>>(new Set());

  const project = (id: string) => lookups.projects.find((p) => p.id === id)?.name ?? "";
  const person = (id: string) => { const m = lookups.members.find((x) => x.user_id === id); return m ? emailName(m.email) : ""; };
  const today = controller.todayDate();

  const groups = useMemo(() => {
    const inScope = controller.rows.filter((r) => scope.projectIds === null || scope.projectIds.includes(r.home_project)) as unknown as PhoneRow[];
    const filtered = filterPhoneRows(inScope, { query, chips, me, today, project, person });
    return { total: filtered.length, groups: groupPhoneRows(sortPhoneRows(filtered, sort), group, project) };
    // the controller changes its rows in place; the version says when
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, status.version, scope.projectIds, query, chips, sort, group, me]);

  const toggle = (id: string) => setChips((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const flip = (key: string) => setClosed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const chip = (id: string, label: string) => (
    <button key={id} type="button" className={chips.includes(id) ? "phone-chip phone-chip-on" : "phone-chip"} aria-pressed={chips.includes(id)} onClick={() => toggle(id)}>{label}</button>
  );

  return (
    <div className="phone-list">
      <div className="phone-sticky">
        <label className="visually-hidden" htmlFor="phone-search">Search initiatives</label>
        <input id="phone-search" type="search" className="phone-search" placeholder="Search code, name, owner, project…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="phone-chips" role="group" aria-label="Quick filters">
          {FIXED_CHIPS.map((c) => chip(c.id, c.label))}
          {PHASE_CHIPS.map((c) => chip(c.id, c.label))}
        </div>
        <div className="phone-tools">
          <label>Sort <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>{(Object.keys(SORT_LABEL) as Sort[]).map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}</select></label>
          <label>Group <select value={group} onChange={(e) => setGroup(e.target.value as Group)}>{(Object.keys(GROUP_LABEL) as Group[]).map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}</select></label>
          {chips.length > 0 || query ? <button type="button" className="link-button" onClick={() => { setChips([]); setQuery(""); }}>Clear</button> : null}
        </div>
        <p className="muted phone-count" role="status">{groups.total} {groups.total === 1 ? "initiative" : "initiatives"}</p>
      </div>
      {groups.total === 0 && <p className="notice-box">Nothing matches. {chips.length + (query ? 1 : 0) > 0 ? "Clear the filters to see everything." : ""}</p>}
      {groups.groups.map((g) => (
        <section key={g.key} aria-label={g.label}>
          {group !== "none" && (
            <h2 className="phone-group"><button type="button" aria-expanded={!closed.has(g.key)} onClick={() => flip(g.key)}>{closed.has(g.key) ? "▸" : "▾"} {g.label} ({g.rows.length})</button></h2>
          )}
          {!closed.has(g.key) && (
            <ul className="phone-cards">
              {g.rows.map((r) => {
                const progress = r.delivery_progress_pct;
                const owner = person(String(r.product_manager ?? ""));
                return (
                  <li key={r.id}>
                    <Link className="phone-card" href={`/w/${tenantId}/portfolio/${encodeURIComponent(r.item_code)}`}>
                      <span className="phone-card-top"><span className="mono">#{r.stack_rank} · {r.item_code}</span>{r.health ? <span className={`phone-health phone-health-${String(r.health).toLowerCase().replace(/\s+/g, "-")}`}>{String(r.health)}</span> : null}</span>
                      <span className="phone-card-name">{r.initiative_name}</span>
                      <span className="muted phone-card-meta">
                        {[group === "phase" ? "" : String(r.initiative_phase ?? ""), typeof progress === "number" && r.initiative_phase === "Build" ? `${Math.round(progress)}% built` : "", project(r.home_project), owner, String(r.g2m_quarter ?? ""), r.gate_status && r.gate_status !== "Not started" ? `Gate: ${String(r.gate_status)}` : ""].filter(Boolean).join(" · ")}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
