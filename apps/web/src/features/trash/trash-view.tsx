"use client";

import { useEffect, useId, useState } from "react";
import { canPurge, canSeeTrash, daysLeftInTrash, TRASH_DAYS } from "@pv/domain";
import type { PortfolioDataSource } from "../portfolio/data-source";
import type { Lookups, TrashedItem } from "../portfolio/types";

type Props = { source: PortfolioDataSource; lookups: Lookups; role: string | null; now?: number };

const dateText = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** The Trash: what was deleted, by whom and when. Restore puts items back at their old rank; admins can delete forever. */
export function TrashView({ source, lookups, role, now: nowProp }: Props) {
  const [items, setItems] = useState<TrashedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [now] = useState(() => nowProp ?? Date.now());
  const allId = useId();

  useEffect(() => {
    let cancelled = false;
    source.loadTrash().then((r) => { if (!cancelled) setItems(r); }, (e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [source]);

  if (!canSeeTrash(role)) return <><div className="page-head"><h1>Trash</h1></div><p className="muted">Only creators and admins can see the Trash.</p></>;
  const person = (id: string | null) => (id ? lookups.members.find((m) => m.user_id === id)?.email ?? "someone who left" : "unknown");
  const project = (id: string) => lookups.projects.find((p) => p.id === id)?.name ?? "";
  const list = items ?? [];
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });
  const allPicked = list.length > 0 && list.every((i) => picked.has(i.id));

  const reasonsText = (failed: { id: string; reason: string }[]) => (failed.length ? ` ${failed.length} could not be handled: ${failed[0]!.reason}` : "");
  const restore = async (ids: string[]) => {
    if (ids.length === 0) return;
    setBusy(true); setError(null); setMessage(null);
    const r = await source.restoreItems(ids);
    setBusy(false);
    if (!r.ok) { setError(`Could not restore: ${r.error}`); return; }
    const back = new Set(r.restored.map((x) => x.id));
    setItems((cur) => (cur ?? []).filter((i) => !back.has(i.id)));
    setPicked((s) => new Set([...s].filter((id) => !back.has(id))));
    setMessage(`Restored ${r.restored.length} ${r.restored.length === 1 ? "initiative" : "initiatives"} at their old rank.${reasonsText(r.failed)}`);
  };
  const purge = async (ids: string[]) => {
    setBusy(true); setError(null); setMessage(null);
    const r = await source.purgeItems(ids);
    setBusy(false);
    setPurgeOpen(false);
    if (!r.ok) { setError(`Could not delete: ${r.error}`); return; }
    const bad = new Set(r.failed.map((f) => f.id));
    const gone = new Set(ids.filter((id) => !bad.has(id)));
    setItems((cur) => (cur ?? []).filter((i) => !gone.has(i.id)));
    setPicked((s) => new Set([...s].filter((id) => !gone.has(id))));
    setMessage(`Deleted ${gone.size} ${gone.size === 1 ? "initiative" : "initiatives"} forever.${reasonsText(r.failed)}`);
  };

  return (
    <>
      <div className="page-head"><h1>Trash</h1></div>
      <p className="muted">Deleted initiatives stay here for {TRASH_DAYS} days, then they are deleted for good. Restoring puts an initiative back at its old rank. Item codes are never reused.</p>
      {error && <div role="alert" className="error">{error}</div>}
      <p role="status" className="trash-status">{message}</p>
      {items === null && !error && <p role="status" className="muted">Loading the Trash…</p>}
      {items !== null && list.length === 0 && <p>The Trash is empty.</p>}
      {list.length > 0 && (
        <>
          <div className="trash-actions">
            <button type="button" className="btn btn-primary" disabled={busy || picked.size === 0} onClick={() => void restore([...picked])}>Restore {picked.size > 0 ? picked.size : ""} selected</button>
            {canPurge(role) && <button type="button" className="btn btn-danger" disabled={busy || picked.size === 0} onClick={() => setPurgeOpen(true)}>Delete forever…</button>}
            <span className="muted">{picked.size} of {list.length} selected</span>
          </div>
          <table className="trash-table">
            <thead>
              <tr>
                <th scope="col"><input id={allId} type="checkbox" aria-label="Select all deleted initiatives" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(list.map((i) => i.id)))} /></th>
                <th scope="col">ID</th><th scope="col">Initiative</th><th scope="col">Project</th><th scope="col">Deleted by</th><th scope="col">Deleted</th><th scope="col">Removed for good in</th><th scope="col"><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {list.map((i) => {
                const left = daysLeftInTrash(i.deleted_at, now);
                return (
                  <tr key={i.id}>
                    <td><input type="checkbox" aria-label={`Select ${i.item_code} ${i.initiative_name}`} checked={picked.has(i.id)} onChange={() => toggle(i.id)} /></td>
                    <td className="mono">{i.item_code}</td>
                    <td>{i.initiative_name}</td>
                    <td>{project(i.home_project)}</td>
                    <td>{person(i.deleted_by)}</td>
                    <td>{dateText(i.deleted_at)}</td>
                    <td>{left} {left === 1 ? "day" : "days"}</td>
                    <td><button type="button" className="btn" disabled={busy} onClick={() => void restore([i.id])} aria-label={`Restore ${i.item_code} ${i.initiative_name}`}>Restore</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
      {purgeOpen && <PurgeDialog count={picked.size} onCancel={() => setPurgeOpen(false)} onConfirm={() => void purge([...picked])} />}
    </>
  );
}

/** Delete forever cannot be undone, so it asks for a typed confirmation. */
function PurgeDialog({ count, onCancel, onConfirm }: { count: number; onCancel: () => void; onConfirm: () => void }) {
  const titleId = useId();
  const [typed, setTyped] = useState("");
  const ok = typed.trim().toLowerCase() === "delete forever";
  return (
    <div className="dialog-backdrop" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } }}>
      <div className="dialog dialog-narrow" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>Delete {count} {count === 1 ? "initiative" : "initiatives"} forever?</h2>
        <p>This cannot be undone. {count === 1 ? "Its" : "Their"} fields, tags, links and files are removed. The change log keeps only the item code and name.</p>
        <label htmlFor={`${titleId}-t`} className="dialog-label">Type <strong>delete forever</strong> to confirm</label>
        <input id={`${titleId}-t`} autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-danger" disabled={!ok} onClick={onConfirm}>Delete forever</button>
        </div>
      </div>
    </div>
  );
}
