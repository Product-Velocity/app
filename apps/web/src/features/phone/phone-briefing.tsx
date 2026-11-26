"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { changeTypeLabel } from "@pv/domain";
import type { PortfolioController } from "../portfolio/controller";
import type { GridItem, Lookups } from "../portfolio/types";
import { briefingFacts, briefingFlags, briefingText, buildLine, gateLine, type BriefingRow } from "./briefing";
import { useFollow } from "./follow";
import { ago } from "./phone-changes";
import { QuickChangeSheet } from "./phone-quick-change";
import { QUICK_FIELDS, quickChangeText, type QuickField } from "./quick-change";
import { supabaseQuickChangeSource, type QuickChangeSource } from "./quick-change-source";
import { useStatus } from "../portfolio/status-strip";
import { usePhoneChanges, type ChangeSource } from "./use-phone-changes";
import { peopleOf } from "../portfolio/people";

const emailName = (e: string) => e.split("@")[0]!.replace(/[._]/g, " ");
const LATEST = 5;

/** One initiative on a phone, read first: where it stands, what needs attention, what and why, the build, the latest changes. Editing is one button away (issue #635, slice P4). */
export function PhoneBriefing({ controller, lookups, row, tenantId, onEdit, changeSource, quickSource = supabaseQuickChangeSource }: { controller: PortfolioController; lookups: Lookups; row: GridItem; tenantId: string; onEdit: () => void; changeSource?: ChangeSource; quickSource?: QuickChangeSource }) {
  const status = useStatus(controller); // the roadmap changes its rows in place after a save or a refresh; the version says when
  const r = row as unknown as BriefingRow;
  const [more, setMore] = useState(false);
  const [copied, setCopied] = useState<boolean | null>(null);
  const follow = useFollow();
  const [followError, setFollowError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<QuickField | null>(null);
  const [done, setDone] = useState<{ field: QuickField; from: string | null; to: string; undoing?: boolean; error?: string } | null>(null);
  const following = follow?.isFollowing(r.id) ?? false;
  const changes = usePhoneChanges(controller, tenantId, changeSource);
  const person = (id: string) => { const m = peopleOf(lookups).find((x) => x.id === id); return m ? emailName(m.name) : ""; };
  const project = lookups.projects.find((p) => p.id === r.home_project)?.name ?? "";
  const facts = useMemo(() => briefingFacts(r, { person }), [r, lookups, status.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const flags = useMemo(() => briefingFlags(r, controller.todayDate()), [r, controller, status.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const body = briefingText(r);
  const build = buildLine(r);
  const mine = useMemo(() => changes.rows.filter((c) => c.itemId === r.id), [changes.rows, r.id]);
  const issue = mine.find((c) => c.issue)?.issue ?? null;
  const now = new Date();
  const health = text(r.health);
  const phaseWord = text(r.initiative_phase);

  async function toggleFollow() {
    if (!follow) return;
    const res = await follow.toggle(r.id);
    setFollowError(res.ok ? null : res.error);
  }

  /** A quick change was saved: show the roadmap as it is now, reload the changes, and offer to put it back. */
  async function changed(r: { field: QuickField; from: string | null; to: string }) {
    setSheet(null); setDone(r);
    await controller.refreshFromServer();
    changes.reload();
  }
  async function putBack() {
    if (!done || done.from === null) return;
    setDone({ ...done, undoing: true });
    const res = await quickSource.change(r.id, done.field, done.from, "Put back as it was.");
    if (!res.ok) { setDone({ ...done, undoing: false, error: res.error }); return; }
    setDone(null);
    await controller.refreshFromServer();
    changes.reload();
  }

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

      {controller.canEdit && (
        <section className="briefing-card" aria-labelledby="b-update">
          <h2 id="b-update">Update</h2>
          <div className="briefing-update">
            {(Object.keys(QUICK_FIELDS) as QuickField[]).map((f) => (
              <button key={f} type="button" className="btn" onClick={() => { setDone(null); setSheet(f); }}>Change {QUICK_FIELDS[f].label.toLowerCase()}</button>
            ))}
          </div>
          {done && (
            <p role="status">
              Saved. {quickChangeText(done.field, done.from, done.to)}.{" "}
              {done.from !== null && <button type="button" className="link-button" disabled={done.undoing} onClick={() => void putBack()}>{done.undoing ? "Putting it back…" : "Put it back"}</button>}
              {done.error && <span role="alert" className="pf-error"> {done.error}</span>}
            </p>
          )}
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
              {c.note ? <span className="briefing-note">Why: {c.note}</span> : null}
            </li>
          ))}
        </ul>
      </section>

      <div className="briefing-actions">
        <button type="button" className="btn btn-primary briefing-edit" onClick={onEdit}>Edit details</button>
        {follow && <button type="button" className="btn" aria-pressed={following} onClick={() => void toggleFollow()}>{following ? "Following" : "Follow"}</button>}
        <button type="button" className="btn" onClick={copy}>Copy link</button>
      </div>
      {followError && <p role="alert" className="pf-error">{followError}</p>}
      {following && <p className="muted">You follow this initiative. Its changes come first in Initiatives. Nobody is told.</p>}
      {sheet && <QuickChangeSheet field={sheet} itemLabel={`${r.item_code} ${r.initiative_name}`} current={text(sheet === "health" ? r.health : r.initiative_status) || null} source={quickSource} itemId={r.id} onClose={() => setSheet(null)} onDone={(x) => void changed(x)} />}
      {copied !== null && <p role="status" className="muted">{copied ? "Link copied." : "Could not copy the link."}</p>}
    </article>
  );
}

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));
