"use client";

import { FIELD_BY_KEY, cardDate, cardFieldOffer, initialsOf, moscowTone, stageAge, type CardRender } from "@pv/domain";
import type { ReactNode } from "react";
import { StatusPill } from "../../components/status-pill";
import { PILL_FIELDS, statusTone, toneFor } from "../../components/status-tone";
import type { GridItem } from "../portfolio/types";

/** A tracker link shown next to the initiative ID: the GitHub issue (`#42`) or the Jira key (`PROJ-12`). */
export type TrackerRef = { tracker: "github" | "jira"; label: string; url: string | null };

/** Only web links are followed (a stored link is data, never trusted to be a safe address). */
export const safeHref = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try { const u = new URL(url); return u.protocol === "https:" || u.protocol === "http:" ? u.href : null; } catch { return null; }
};

const TRACKER_NAME = { github: "GitHub", jira: "Jira" } as const;

/** The tone class of the left edge: health, as a colour on top of the health word (never instead of it). */
export const healthStripe = (health: string): string => (health ? statusTone(health) : "none");

/**
 * The face of a card, in four zones (decision 2026-11-22-card-layout.md): header (rank, initiative ID, tracker IDs, health),
 * name, chosen fields (pills, dates, figures) and a footer (owner, time in stage, actions). Used by the board and by the preview in the picker.
 */
export function CardFace({ row, fields, owner, ownerTitle, trackers, today, onOpen, actions, preview = false }: {
  row: GridItem; fields: readonly string[]; owner: string; ownerTitle?: string; trackers: readonly TrackerRef[]; today: Date;
  onOpen?: () => void; actions?: ReactNode; preview?: boolean;
}) {
  const health = row.health ? String(row.health) : "";
  const age = stageAge(row as { initiative_phase?: unknown; phase_changed_at?: unknown; initiative_status?: unknown }, today);
  const phase = typeof row.initiative_phase === "string" ? row.initiative_phase : "";
  return (
    <>
      <div className="kc-top">
        <span className="kc-ids">
          <span className="kc-rank" title={`Stack rank ${row.stack_rank}`}><span className="visually-hidden">Stack rank </span>{String(row.stack_rank)}</span>
          {onOpen && !preview
            ? <button type="button" className="kc-id mono" title={`Open ${row.item_code}`} onClick={(e) => { e.stopPropagation(); onOpen(); }}>{row.item_code}</button>
            : <span className="kc-id mono">{row.item_code}</span>}
          {trackers.map((t) => {
            const href = safeHref(t.url);
            const title = `${TRACKER_NAME[t.tracker]} ${t.label}${href ? " (opens in a new tab)" : ""}`;
            return href && !preview
              ? <a key={t.tracker + t.label} className="kc-ext mono" href={href} target="_blank" rel="noreferrer noopener" title={title} aria-label={title} onClick={(e) => e.stopPropagation()}>{t.label}</a>
              : <span key={t.tracker + t.label} className="kc-ext kc-ext-plain mono" title={title}>{t.label}</span>;
          })}
        </span>
        {health && <StatusPill value={health} />}
      </div>
      <div className="kc-name">{row.initiative_name}</div>
      {fields.length > 0 && <div className="kc-chips">{fields.map((k) => <FieldChip key={k} k={k} value={row[k]} today={today} />)}</div>}
      <div className="kc-foot">
        {owner
          ? <span className="kc-owner" title={ownerTitle}><span className="kc-avatar" aria-hidden="true">{initialsOf(owner)}</span>{owner}</span>
          : <span className="kc-owner muted">No owner</span>}
        <span className="kc-foot-end">
          {age && (
            <span className="kc-age" data-over={age.over} title={`${age.days} days in ${phase}${age.over ? ", past the usual limit" : ""}`}>
              {age.days}d{age.over ? " over" : ""}
            </span>
          )}
          {actions}
        </span>
      </div>
    </>
  );
}

/** One chosen field, drawn by its type: size circle, pill, date, figure, progress bar or avatar. Empty values draw nothing. */
function FieldChip({ k, value, today }: { k: string; value: unknown; today: Date }) {
  const def = FIELD_BY_KEY[k];
  const offer = cardFieldOffer(k);
  if (!def || !offer.ok || value == null || value === "") return null;
  const render: CardRender = offer.render;
  const name = def.name;
  const text = String(value);
  if (render === "size") return <span className="kc-size" title={`${name}: ${text}`}><span className="visually-hidden">{name} </span>{text}</span>;
  if (render === "date") { const d = cardDate(value, today); return d ? <span className="pill kc-pill kc-date" title={`${name}: ${text.slice(0, 10)}`}><span className="visually-hidden">{name} </span>{d}</span> : null; }
  if (render === "progress") {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return null;
    const pct = Math.max(0, Math.min(100, Math.round(n <= 1 && n > 0 && !Number.isInteger(n) ? n * 100 : n)));
    return (
      <span className="kc-progress" title={`${name}: ${pct}%`}>
        <span className="kc-bar" role="progressbar" aria-label={name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></span>
        <span className="kc-pct">{pct}%</span>
      </span>
    );
  }
  if (render === "stat") return <span className="kc-stat" title={`${name}: ${text}`}><span className="muted">{name}</span> {text}</span>;
  if (render === "person") return <span className="pill kc-pill" title={`${name}: ${text}`}><span className="kc-avatar kc-avatar-sm" aria-hidden="true">{initialsOf(text.split("@")[0]!)}</span><span className="visually-hidden">{name} </span>{text.split("@")[0]}</span>;
  if (render === "flag") return value === true || text === "Yes" ? <span className="pill kc-pill" title={name}>{name}</span> : null;
  // pill: MoSCoW by weight, status words by their tone, every other value neutral; a tag list is one pill per tag
  const tags = def.type === "Tags" ? text.split(/,\s*/).filter(Boolean) : [text];
  return (
    <>
      {tags.map((t) => {
        const m = k === "moscow" ? moscowTone(t) : null;
        if (m) return <span key={t} className={`pill kc-pill kc-moscow kc-moscow-${m}`} title={`${name}: ${t}`}><span className="visually-hidden">{name} </span>{t}</span>;
        if (PILL_FIELDS.has(k)) return <StatusPill key={t} value={t} tone={toneFor(k, t)} className="kc-pill" />;
        return <span key={t} className="pill kc-pill" title={`${name}: ${t}`}><span className="visually-hidden">{name} </span>{t}</span>;
      })}
    </>
  );
}
