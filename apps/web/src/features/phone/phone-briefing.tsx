"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { changeTypeLabel } from "@pv/domain";
import type { PortfolioController } from "../portfolio/controller";
import type { GridItem, Lookups } from "../portfolio/types";
import { briefingFacts, briefingFlags, briefingText, buildLine, gateLine, type BriefingRow } from "./briefing";
import { ago } from "./phone-changes";
import { usePhoneChanges, type ChangeSource } from "./use-phone-changes";

const emailName = (e: string) => e.split("@")[0]!.replace(/[._]/g, " ");
const LATEST = 5;

/** One initiative on a phone, read first: where it stands, what needs attention, what and why, the build, the latest changes. Editing is one button away (issue #635, slice P4). */
export function PhoneBriefing({ controller, lookups, row, tenantId, onEdit, changeSource }: { controller: PortfolioController; lookups: Lookups; row: GridItem; tenantId: string; onEdit: () => void; changeSource?: ChangeSource }) {
  const r = row as unknown as BriefingRow;
  const [more, setMore] = useState(false);
  const [copied, setCopied] = useState<boolean | null>(null);
  const changes = usePhoneChanges(controller, tenantId, changeSource);
  const person = (id: string) => { const m = lookups.members.find((x) => x.user_id === id); return m ? emailName(m.email) : ""; };
  const project = lookups.projects.find((p) => p.id === r.home_project)?.name ?? "";
  const facts = useMemo(() => briefingFacts(r, { person }), [r, lookups]); // eslint-disable-line react-hooks/exhaustive-deps
  const flags = useMemo(() => briefingFlags(r, controller.todayDate()), [r, controller]);
  const body = briefingText(r);
  const build = buildLine(r);
  const mine = useMemo(() => changes.rows.filter((c) => c.itemId === r.id), [changes.rows, r.id]);
  const issue = mine.find((c) => c.issue)?.issue ?? null;
  const now = new Date();
  const health = text(r.health);
  const phaseWord = text(r.initiative_phase);

  async function copy() {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); } catch { setCopied(false); }
  }

  return (
    <article className="briefing" aria-labelledby="briefing-title">
      <header className="briefing-head">
        <p className="briefing-code"><span className="mono">{r.item_code}</span>{project ? <span className="briefing-project">{project}</span> : null}</p>
        <h1 id="briefing-title" className="briefing-title">{r.initiative_name}</h1>
        <p className="briefing-pills">
          {health ? <span className={`phone-health phone-health-${health.toLowerCase().replace(/\s+/g, "-")}`}>Health: {health}</span> : <span className="phone-health">No health set</span>}
          {phaseWord ? <span className="phone-health">{phaseWord}</span> : null}
        </p>
        <p className="muted">#{r.stack_rank} globally</p>
      </header>

      {flags.length > 0 && (
        <section className="briefing-card briefing-attention" aria-labelledby="b-attn">
          <h2 id="b-attn">Needs attention</h2>
          <ul>{flags.map((f) => <li key={f.label}><strong>{f.label}.</strong> {f.text}</li>)}</ul>
        </section>
      )}

      <section className="briefing-card" aria-labelledby="b-where">
        <h2 id="b-where">Where it stands</h2>
        <dl className="briefing-facts">
          {facts.map((f) => <div key={f.label}><dt>{f.label}</dt><dd className={f.value === "Not set" ? "muted" : undefined}>{f.value}</dd></div>)}
          <div><dt>Gate</dt><dd>{gateLine(r)}</dd></div>
        </dl>
        <p><Link href={`/w/${tenantId}/decisions`}>Open decisions</Link></p>
      </section>

      {(body.short || body.hypothesis) && (
        <section className="briefing-card" aria-labelledby="b-why">
          <h2 id="b-why">What and why</h2>
          {more ? (
            <>
              {body.description && <p className="briefing-text">{body.description}</p>}
              {body.hypothesis && <p className="briefing-text"><strong>Hypothesis.</strong> {body.hypothesis}</p>}
            </>
          ) : <p className="briefing-text">{body.short}</p>}
          {body.more && <button type="button" className="link-button" aria-expanded={more} onClick={() => setMore((v) => !v)}>{more ? "Show less" : "Read more"}</button>}
        </section>
      )}

      {(build || issue) && (
        <section className="briefing-card" aria-labelledby="b-build">
          <h2 id="b-build">Build</h2>
          {build && (
            <>
              <p>{build.text}</p>
              {build.pct !== null && <div className="meter" role="img" aria-label={`${build.pct}% built`}><span className="meter-fill" style={{ width: `${build.pct}%` }} /></div>}
            </>
          )}
          {issue && <p className="muted">{issue.tracker}: {issue.url ? <a href={issue.url} target="_blank" rel="noopener noreferrer">{issue.key}</a> : issue.key}{issue.title ? `, ${issue.title}` : ""}</p>}
          <p className="muted">Progress comes from the tracker and cannot be edited here.</p>
        </section>
      )}

      <section className="briefing-card" aria-labelledby="b-changes">
        <h2 id="b-changes">Latest changes</h2>
        {changes.loading && <p role="status" className="muted">Loading changes…</p>}
        {changes.error && <p role="alert" className="pf-error">Could not load changes: {changes.error}</p>}
        {!changes.loading && !changes.error && mine.length === 0 && <p className="muted">Nothing has changed in the last 30 days.</p>}
        <ul className="briefing-changes">
          {mine.slice(0, LATEST).map((c) => (
            <li key={c.id}>
              <span className={`phone-change phone-change-${c.tone}`}>{changeTypeLabel(c.type)}: {c.from ? `${c.from} → ${c.to ?? "empty"}` : c.to}</span>
              <span className="muted"> {c.source} · {ago(c.at, now)}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="briefing-actions">
        <button type="button" className="btn btn-primary" onClick={onEdit}>Edit details</button>
        <button type="button" className="btn" onClick={copy}>Copy link</button>
      </div>
      {copied !== null && <p role="status" className="muted">{copied ? "Link copied." : "Could not copy the link."}</p>}
    </article>
  );
}

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));
