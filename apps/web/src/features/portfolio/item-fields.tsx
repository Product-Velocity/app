"use client";

import { DateInput } from "@/components/date-input";
import { SelectField } from "@/components/search-list";
import { useId, useState, type ReactNode } from "react";
import {
  canBeEmpty, dateEdge, optionsFor, panelField, quarterMismatch, resolveGroup, type FieldDef, type Link, type PanelField, type RelatedField,
} from "@pv/domain";
import type { PortfolioController } from "./controller";
import { formatField } from "./format";
import { FilesControl } from "./files-control";
import { MarkdownPreview } from "./markdown-preview";
import type { GridItem, Lookups } from "./types";

export type FieldCtx = { controller: PortfolioController; lookups: Lookups };

const isGithub = (f: FieldDef) => f.mode === "locked" || f.storage.startsWith("GitHub-synced");

/** One field of the item panel: its name, an editor that fits its type, and the reason when it cannot be edited. */
export function FieldRow({ f, row, ctx }: { f: FieldDef; row: GridItem; ctx: FieldCtx }) {
  const id = useId();
  const p = panelField(f);
  const [error, setError] = useState<string | null>(null);
  const canEdit = ctx.controller.canEdit;
  const hint = p.kind === "later" ? p.reason : p.kind === "readonly" ? p.reason : null;
  const common = { id, f, row, ctx, disabled: !canEdit, onError: setError };
  let control: ReactNode;
  switch (p.kind) {
    case "date": control = <DateControl {...common} />; break;
    case "text": case "longtext": case "number": case "currency": control = <TextControl {...common} kind={p.kind} />; break;
    case "select": case "boolean": case "person": case "project": control = <SelectControl {...common} kind={p.kind} />; break;
    case "group": control = <GroupControl {...common} />; break;
    case "rank": control = <RankControl {...common} />; break;
    case "tags": case "links": case "relations": case "teams": case "people": control = <ListControl {...common} kind={p.kind} />; break;
    case "skills": control = <SkillsControl {...common} />; break;
    case "files": control = <FilesControl itemId={row.id} disabled={!canEdit} onError={setError} />; break;
    default: control = <ReadOnlyValue f={f} row={row} ctx={ctx} later={p.kind === "later"} />;
  }
  const isList = ["tags", "links", "relations", "teams", "people", "skills", "files"].includes(p.kind);
  return (
    <div className={`pf pf-${p.kind}`} data-field={f.key}>
      {isList ? <div className="pf-label" id={`${id}-l`}>{f.name}</div> : <label className="pf-label" htmlFor={id}>{f.name}</label>}
      {badge(f, p)}
      <div className="pf-control" {...(isList ? { role: "group", "aria-labelledby": `${id}-l` } : {})}>{control}</div>
      {hint && <p className="pf-hint">{hint}</p>}
      {f.key === "g2m_quarter" && quarterMismatch(row.g2m_quarter, row.g2m_date_est) && <p className="pf-hint" role="status">G2M date is outside the planned quarter. Nothing was changed.</p>}
      {f.description && !["readonly", "later", "select"].includes(p.kind) && <p className="pf-help">{f.description}</p>}
      {p.kind === "currency" && <p className="pf-help">{ctx.lookups.currency ? `Amounts are in ${ctx.lookups.currency}, the organization currency.` : "No organization currency is set yet. An admin sets it under Workspace settings."}</p>}
      {error && <p role="alert" className="pf-error">{error}</p>}
    </div>
  );
}

function badge(f: FieldDef, p: PanelField): ReactNode {
  if (p.kind === "people") return <span className="pf-badge">Two-way with GitHub</span>;
  if (p.kind === "later") return <span className="pf-badge">Arrives in phase {p.phase}</span>;
  if (isGithub(f)) return <span className="pf-badge">From GitHub</span>;
  if (p.kind === "readonly" && f.mode === "computed") return <span className="pf-badge">Calculated</span>;
  if (p.kind === "readonly" && f.mode === "system") return <span className="pf-badge">Set by the system</span>;
  return null;
}

type Common = { id: string; f: FieldDef; row: GridItem; ctx: FieldCtx; disabled: boolean; onError: (e: string | null) => void };

function ReadOnlyValue({ f, row, ctx, later }: { f: FieldDef; row: GridItem; ctx: FieldCtx; later: boolean }) {
  const text = formatField(f, row[f.key], { today: ctx.controller.todayDate(), members: ctx.lookups.members, projects: ctx.lookups.projects });
  if (later) return <span className="pf-value muted">Not available yet</span>;
  return <span className="pf-value">{text || <span className="muted">{f.key === "status" ? "Not on GitHub" : "Not set"}</span>}</span>;
}

// ---------------------------------------------------------------- one value
/** A date: typed in the person's own format (or words), or picked from the calendar button. */
function DateControl({ id, f, row, ctx, disabled, onError }: Common) {
  return (
    <DateInput
      id={id}
      label={f.name}
      value={row[f.key] == null ? "" : String(row[f.key])}
      today={ctx.controller.todayDate()}
      edge={dateEdge(f.key)}
      disabled={disabled}
      onCommit={(iso) => { const r = ctx.controller.edit(row.id, f.key, iso); onError(r.ok ? null : r.error); }}
    />
  );
}

/** The Description: Markdown in a taller box, with a Preview of how it reads in GitHub. */
function MarkdownControl({ text, ...shared }: { text: string; id: string; value: string; disabled: boolean; onFocus: () => void; onChange: (e: { target: { value: string } }) => void; onBlur: (e: { target: { value: string } }) => void }) {
  const [preview, setPreview] = useState(false);
  return (
    <div className="md-control">
      <div className="md-tabs" role="group" aria-label="Description view">
        <button type="button" className={preview ? "tool-btn" : "tool-btn tool-btn-on"} aria-pressed={!preview} onClick={() => setPreview(false)}>Write</button>
        <button type="button" className={preview ? "tool-btn tool-btn-on" : "tool-btn"} aria-pressed={preview} onClick={() => setPreview(true)}>Preview</button>
        <span className="muted md-count">{text.length.toLocaleString("en-GB")} of 20,000 characters · Markdown</span>
      </div>
      {preview ? <MarkdownPreview text={text} /> : (
        <textarea {...shared} rows={12} spellCheck onKeyDown={(e) => { if (e.key === "Escape") { (e.target as HTMLElement).blur(); e.stopPropagation(); } }} />
      )}
    </div>
  );
}

function TextControl({ id, f, row, ctx, disabled, onError, kind }: Common & { kind: "text" | "longtext" | "number" | "currency" | "date" }) {
  const stored = formatField(f, row[f.key], { today: ctx.controller.todayDate(), members: ctx.lookups.members, projects: ctx.lookups.projects });
  const raw = kind === "number" || kind === "text" || kind === "longtext" ? (row[f.key] == null ? "" : String(row[f.key])) : stored;
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (text: string) => {
    setDraft(null);
    if (text === raw) { onError(null); return; }
    const r = ctx.controller.edit(row.id, f.key, text);
    onError(r.ok ? null : r.error);
  };
  const shared = {
    id, value: draft ?? raw, disabled, "aria-describedby": undefined,
    onFocus: () => setDraft(raw),
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: (e: { target: { value: string } }) => { if (draft !== null) commit(e.target.value); },
  };
  if (kind === "longtext" && f.key === "description") return <MarkdownControl {...shared} text={draft ?? raw} />;
  if (kind === "longtext") {
    return <textarea {...shared} rows={4} onKeyDown={(e) => { if (e.key === "Escape") { setDraft(null); (e.target as HTMLElement).blur(); e.stopPropagation(); } }} />;
  }
  return (
    <input
      {...shared} type="text" inputMode={kind === "number" || kind === "currency" ? "decimal" : undefined}
      placeholder={kind === "date" ? "for example 31 Mar or Q2" : kind === "currency" ? "for example 1.2m" : undefined}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLElement).blur();
        else if (e.key === "Escape") { setDraft(null); e.stopPropagation(); (e.target as HTMLElement).blur(); }
      }}
    />
  );
}

function SelectControl({ id, f, row, ctx, disabled, onError, kind }: Common & { kind: "select" | "boolean" | "person" | "project" }) {
  const options =
    kind === "person" ? ctx.lookups.members.map((m) => ({ value: m.user_id, label: m.email }))
    : kind === "project" ? ctx.lookups.projects.map((p) => ({ value: p.id, label: p.name }))
    : optionsFor(f.key);
  const current = kind === "boolean" ? (row[f.key] == null ? "" : row[f.key] ? "Yes" : "No") : row[f.key] == null ? "" : String(row[f.key]);
  const empty = kind === "project" ? false : canBeEmpty(f.key);
  const blank = empty ? (kind === "person" ? "Unassigned" : "Not set") : current === "" ? "Choose…" : undefined;
  const all = current !== "" && !options.some((o) => o.value === current) ? [...options, { value: current, label: current }] : options;
  return (
    <SelectField
      id={id} label={f.name} value={current} disabled={disabled} options={all} {...(blank !== undefined ? { blank } : {})}
      onChange={(v) => { const r = ctx.controller.edit(row.id, f.key, v); onError(r.ok ? null : r.error); }}
    />
  );
}

/** Initiative Group is an open list: pick one of the workspace's groups or type a new one. */
function GroupControl({ id, f, row, ctx, disabled, onError }: Common) {
  const stored = row[f.key] == null ? "" : String(row[f.key]);
  const [draft, setDraft] = useState<string | null>(null);
  const names = ctx.controller.groupNames();
  const shown = draft ?? stored;
  const r = draft !== null ? resolveGroup(draft, names) : null;
  const commit = (text: string) => {
    setDraft(null);
    if (text.trim() === stored) { onError(null); return; }
    const res = ctx.controller.edit(row.id, f.key, text);
    onError(res.ok ? null : res.error);
  };
  return (
    <>
      <input
        id={id} type="text" list={`${id}-list`} value={shown} disabled={disabled} autoComplete="off" placeholder="Type to pick or create a group"
        onFocus={() => setDraft(stored)} onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => { if (draft !== null) commit(e.target.value); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLElement).blur(); else if (e.key === "Escape") { setDraft(null); e.stopPropagation(); (e.target as HTMLElement).blur(); } }}
      />
      <datalist id={`${id}-list`}>{names.map((g) => <option key={g} value={g} />)}</datalist>
      {r?.kind === "new" && (
        <p role="status" className="pf-hint">
          “{r.name}” is a new group and will be created.{r.similar.length > 0 && ` Looks like ${r.similar.map((s) => `“${s}”`).join(", ")}: type it exactly to reuse it.`}
        </p>
      )}
    </>
  );
}

/** Stack Rank is both: the global rank and the rank inside the project. Typing a number moves the item. */
function RankControl({ id, row, ctx, disabled, onError }: Common) {
  const [draft, setDraft] = useState<string | null>(null);
  const project = ctx.lookups.projects.find((p) => p.id === row.home_project)?.name ?? "its project";
  const commit = (text: string) => {
    setDraft(null);
    if (text.replace("#", "").trim() === String(row.stack_rank)) { onError(null); return; }
    const r = ctx.controller.editRank(row.id, text);
    onError(r.ok ? null : r.error);
  };
  return (
    <>
      <input
        id={id} type="text" inputMode="numeric" value={draft ?? String(row.stack_rank)} disabled={disabled}
        onFocus={() => setDraft(String(row.stack_rank))} onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => { if (draft !== null) commit(e.target.value); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLElement).blur(); else if (e.key === "Escape") { setDraft(null); e.stopPropagation(); (e.target as HTMLElement).blur(); } }}
      />
      <p className="pf-hint">#{row.stack_rank} globally · #{row.project_rank} in {project}. Type a number to move this initiative.</p>
    </>
  );
}

// ---------------------------------------------------------------- lists
function useRelated(ctx: FieldCtx, itemId: string) {
  return ctx.controller.relatedOf(itemId);
}

function ListControl({ f, row, ctx, disabled, onError, kind }: Common & { kind: "tags" | "links" | "relations" | "teams" | "people" }) {
  const related = useRelated(ctx, row.id);
  if (!related) return <span className="muted" role="status">Loading…</span>;
  const field = f.key as RelatedField;
  const set = (list: unknown[]) => { const r = ctx.controller.editRelated(row.id, field, list); onError(r.ok ? null : r.error); return r.ok; };
  const list = related[field] as unknown[];
  if (kind === "tags") return <TagsEditor name={f.name} values={list as string[]} disabled={disabled} onChange={set} />;
  if (kind === "links") return <LinksEditor values={list as Link[]} disabled={disabled} onChange={set} />;
  if (kind === "relations") return <RelationsEditor ids={list as string[]} self={row.id} ctx={ctx} disabled={disabled} onChange={set} onError={onError} />;
  if (kind === "people") return <PeopleEditor ids={list as string[]} ctx={ctx} disabled={disabled} onChange={set} />;
  return <TeamsEditor ids={list as string[]} ctx={ctx} disabled={disabled} onChange={set} />;
}

function Chip({ label, onRemove, disabled, what }: { label: string; onRemove: () => void; disabled: boolean; what: string }) {
  return (
    <span className="token-chip">
      {label}
      {!disabled && <button type="button" className="chip-x" aria-label={`Remove ${what} ${label}`} onClick={onRemove}>×</button>}
    </span>
  );
}

function TagsEditor({ name, values, disabled, onChange }: { name: string; values: string[]; disabled: boolean; onChange: (l: string[]) => boolean }) {
  const [text, setText] = useState("");
  const add = () => {
    const parts = text.split(",").map((t) => t.trim()).filter(Boolean);
    if (parts.length === 0) return;
    if (onChange([...values, ...parts])) setText("");
  };
  return (
    <div className="pf-chips">
      {values.length === 0 && <span className="muted">None</span>}
      {values.map((v) => <Chip key={v} label={v} what="tag" disabled={disabled} onRemove={() => onChange(values.filter((x) => x !== v))} />)}
      {!disabled && (
        <input
          type="text" aria-label={`Add to ${name}`} placeholder="Add, then Enter" value={text} className="pf-add"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } else if (e.key === "Escape") { setText(""); e.stopPropagation(); } }}
          onBlur={add}
        />
      )}
    </div>
  );
}

function LinksEditor({ values, disabled, onChange }: { values: Link[]; disabled: boolean; onChange: (l: Link[]) => boolean }) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const add = () => { if (url.trim() === "") return; if (onChange([...values, { label, url }])) { setLabel(""); setUrl(""); } };
  return (
    <div className="pf-links">
      {values.length === 0 && <span className="muted">None</span>}
      <ul>
        {values.map((l) => (
          <li key={`${l.label}|${l.url}`}>
            <a href={l.url} target="_blank" rel="noopener noreferrer">{l.label || l.url}</a>
            {l.label && <span className="muted"> {l.url}</span>}
            {!disabled && <button type="button" className="chip-x" aria-label={`Remove link ${l.label || l.url}`} onClick={() => onChange(values.filter((x) => x !== l))}>×</button>}
          </li>
        ))}
      </ul>
      {!disabled && (
        <div className="pf-add-link">
          <input type="text" aria-label="Link label (optional)" placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <input type="url" aria-label="Link address" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
          <button type="button" className="btn" onClick={add}>Add link</button>
        </div>
      )}
    </div>
  );
}

function RelationsEditor({ ids, self, ctx, disabled, onChange, onError }: { ids: string[]; self: string; ctx: FieldCtx; disabled: boolean; onChange: (l: string[]) => boolean; onError: (e: string | null) => void }) {
  const [text, setText] = useState("");
  const listId = useId();
  const rows = ctx.controller.rows;
  const label = (id: string) => { const r = ctx.controller.row(id); return r ? `${r.item_code} ${r.initiative_name}` : "removed item"; };
  const add = () => {
    const t = text.trim();
    if (!t) return;
    const code = /^[A-Za-z]+-\d+/.exec(t)?.[0]?.toUpperCase();
    const hit = rows.find((r) => r.id !== self && (r.item_code.toUpperCase() === code || `${r.item_code} ${r.initiative_name}`.toLowerCase() === t.toLowerCase()));
    if (!hit) { onError(`No initiative matches “${t}”. Type a code such as R-12.`); return; }
    if (onChange([...ids, hit.id])) setText("");
  };
  return (
    <div className="pf-chips">
      {ids.length === 0 && <span className="muted">None</span>}
      {ids.map((id) => <Chip key={id} label={label(id)} what="initiative" disabled={disabled} onRemove={() => onChange(ids.filter((x) => x !== id))} />)}
      {!disabled && (
        <>
          <input
            type="text" aria-label="Related initiative (code)" placeholder="R-12, then Enter" list={listId} value={text} className="pf-add"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } else if (e.key === "Escape") { setText(""); e.stopPropagation(); } }}
          />
          <datalist id={listId}>{rows.filter((r) => r.id !== self && !ids.includes(r.id)).slice(0, 300).map((r) => <option key={r.id} value={r.item_code}>{r.initiative_name}</option>)}</datalist>
        </>
      )}
    </div>
  );
}

function TeamsEditor({ ids, ctx, disabled, onChange }: { ids: string[]; ctx: FieldCtx; disabled: boolean; onChange: (l: string[]) => boolean }) {
  const teams = ctx.controller.teams();
  if (teams.length === 0) return <span className="muted">No teams exist in this workspace yet.</span>;
  return (
    <div className="pf-checks">
      {teams.map((t) => (
        <label key={t.id} className="check">
          <input type="checkbox" disabled={disabled} checked={ids.includes(t.id)} onChange={(e) => onChange(e.target.checked ? [...ids, t.id] : ids.filter((x) => x !== t.id))} />
          {t.name}
        </label>
      ))}
    </div>
  );
}

/** The people assigned in Product Velocity. They are matched to the issue's assignees by their GitHub username, so a person without one is marked. */
function PeopleEditor({ ids, ctx, disabled, onChange }: { ids: string[]; ctx: FieldCtx; disabled: boolean; onChange: (l: string[]) => boolean }) {
  const members = ctx.controller.members();
  if (members.length === 0) return <span className="muted">There is nobody to assign yet.</span>;
  return (
    <div className="pf-checks">
      {members.map((m) => (
        <label key={m.user_id} className="check">
          <input type="checkbox" disabled={disabled} checked={ids.includes(m.user_id)} onChange={(e) => onChange(e.target.checked ? [...ids, m.user_id] : ids.filter((x) => x !== m.user_id))} />
          {m.email}
          {m.github_username ? <span className="muted"> · @{m.github_username}</span> : <span className="muted"> · no GitHub username (set on the Account page), so not synced</span>}
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- effort by skill
function SkillsControl({ f, row, ctx, disabled, onError }: Common) {
  const stored = (row[f.key] && typeof row[f.key] === "object" ? (row[f.key] as Record<string, number>) : {}) as Record<string, number>;
  const [name, setName] = useState("");
  const [weeks, setWeeks] = useState("");
  const commit = (next: Record<string, unknown>) => { const r = ctx.controller.setValue(row.id, f.key, next); onError(r.ok ? null : r.error); return r.ok; };
  const add = () => { if (name.trim() && commit({ ...stored, [name.trim()]: weeks })) { setName(""); setWeeks(""); } };
  const entries = Object.entries(stored);
  return (
    <div className="pf-skills">
      {entries.length === 0 && <span className="muted">No estimate</span>}
      <ul>
        {entries.map(([k, v]) => (
          <li key={k}>
            <span>{k}</span>
            <input
              type="text" inputMode="decimal" aria-label={`Person-weeks for ${k}`} defaultValue={String(v)} disabled={disabled} key={`${k}${v}`}
              onBlur={(e) => { if (e.target.value !== String(v)) commit({ ...stored, [k]: e.target.value }); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLElement).blur(); }}
            />
            <span className="muted">person-weeks</span>
            {!disabled && <button type="button" className="chip-x" aria-label={`Remove ${k}`} onClick={() => { const n = { ...stored }; delete n[k]; commit(n); }}>×</button>}
          </li>
        ))}
      </ul>
      {!disabled && (
        <div className="pf-add-link">
          <input type="text" aria-label="Skill" placeholder="Skill, for example backend" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="text" inputMode="decimal" aria-label="Person-weeks for the new skill" placeholder="Person-weeks" value={weeks} onChange={(e) => setWeeks(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
          <button type="button" className="btn" onClick={add}>Add skill</button>
        </div>
      )}
    </div>
  );
}
