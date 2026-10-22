"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { nearDuplicates } from "@pv/domain";
import type { GroupsStore, GroupUsage, MergeReceipt } from "./store";

type Dialog = { kind: "rename" | "merge" | "retire"; group: GroupUsage } | null;

/** Tidy-up of the workspace's Initiative Groups: rename, merge two groups (undoable here), retire unused ones. */
export function GroupsAdmin({ store, canAdmin }: { store: GroupsStore; canAdmin: boolean }) {
  const [groups, setGroups] = useState<GroupUsage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; undo?: MergeReceipt } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const reload = useCallback(async () => {
    try { setGroups(await store.list()); setError(null); } catch (e) { setError(e instanceof Error ? e.message : "Could not load the groups."); }
  }, [store]);
  useEffect(() => {
    let cancelled = false;
    store.list().then((g) => { if (!cancelled) setGroups(g); }, (e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [store]);

  // groups that look alike are suggestions to merge
  const lookAlikes = useMemo(() => {
    const seen = new Set<string>();
    const out: [string, string][] = [];
    for (const g of groups ?? []) for (const o of nearDuplicates(g.name, (groups ?? []).map((x) => x.name))) {
      const key = [g.name, o].sort().join("|");
      if (!seen.has(key)) { seen.add(key); out.push([g.name, o]); }
    }
    return out;
  }, [groups]);

  if (error && !groups) return <p role="alert" className="error">{error}</p>;
  if (!groups) return <p role="status" className="muted">Loading the groups…</p>;

  return (
    <div className="stack">
      {notice && (
        <p role="status" className="notice">
          {notice.text}{" "}
          {notice.undo && (
            <button type="button" className="link-button" onClick={async () => {
              const r = await store.undoMerge(notice.undo!);
              setNotice(r.ok ? { text: `Merge undone: “${notice.undo!.from}” is back with ${r.value} ${r.value === 1 ? "initiative" : "initiatives"}.` } : null);
              if (!r.ok) setError(r.error);
              await reload();
            }}>Undo</button>
          )}
        </p>
      )}
      {error && <p role="alert" className="error">{error}</p>}
      {lookAlikes.length > 0 && (
        <p className="quick-add-similar">Groups that look alike: {lookAlikes.map(([a, b]) => `“${a}” and “${b}”`).join("; ")}. Merge them to keep reports clean.</p>
      )}
      <div className="card">
        <table className="table">
          <caption className="visually-hidden">Initiative Groups</caption>
          <thead>
            <tr>
              <th scope="col">Group</th>
              <th scope="col">Initiatives</th>
              {canAdmin && <th scope="col"><span className="visually-hidden">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && <tr><td colSpan={3} className="muted">No groups yet. They appear when someone types one in the roadmap.</td></tr>}
            {groups.map((g) => (
              <tr key={g.id}>
                <th scope="row">{g.name}</th>
                <td>{g.items}</td>
                {canAdmin && (
                  <td className="row-actions">
                    <button type="button" className="btn" aria-label={`Rename ${g.name}`} onClick={() => setDialog({ kind: "rename", group: g })}>Rename</button>{" "}
                    <button type="button" className="btn" aria-label={`Merge ${g.name} into another group`} disabled={groups.length < 2} onClick={() => setDialog({ kind: "merge", group: g })}>Merge into…</button>{" "}
                    <button type="button" className="btn" aria-label={`Retire ${g.name}`} disabled={g.items > 0} title={g.items > 0 ? "Only a group with no initiatives can be retired. Merge it instead." : undefined} onClick={() => setDialog({ kind: "retire", group: g })}>Retire</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dialog && (
        <GroupDialog
          dialog={dialog} groups={groups} onClose={() => setDialog(null)}
          onDone={async (text, undo) => { setNotice({ text, ...(undo ? { undo } : {}) }); setError(null); await reload(); }}
          store={store}
        />
      )}
    </div>
  );
}

function GroupDialog({ dialog, groups, store, onClose, onDone }: { dialog: NonNullable<Dialog>; groups: GroupUsage[]; store: GroupsStore; onClose: () => void; onDone: (text: string, undo?: MergeReceipt) => Promise<void> }) {
  const id = useId();
  const g = dialog.group;
  const others = groups.filter((x) => x.id !== g.id);
  const [name, setName] = useState(g.name);
  const [target, setTarget] = useState(others[0]?.id ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Escape closes the dialog even when the focus has been lost (a disabled button drops it while saving)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  const count = (n: number) => `${n} ${n === 1 ? "initiative" : "initiatives"}`;

  const run = async () => {
    setBusy(true); setErr(null);
    if (dialog.kind === "rename") {
      const r = await store.rename(g.id, name);
      if (!r.ok) { setErr(r.error); setBusy(false); return; }
      await onDone(`Renamed “${g.name}” to “${name.trim()}”. ${count(r.value)} updated, each change is in the audit log.`);
    } else if (dialog.kind === "merge") {
      const r = await store.merge(g.id, target);
      if (!r.ok) { setErr(r.error); setBusy(false); return; }
      await onDone(`Merged “${g.name}” into “${r.value.into}”: ${count(r.value.itemIds.length)} moved.`, r.value);
    } else {
      const r = await store.retire(g.id);
      if (!r.ok) { setErr(r.error); setBusy(false); return; }
      await onDone(`Retired “${g.name}”.`);
    }
    onClose();
  };

  const title = dialog.kind === "rename" ? `Rename “${g.name}”` : dialog.kind === "merge" ? `Merge “${g.name}” into another group` : `Retire “${g.name}”?`;
  return (
    <div className="dialog-backdrop">
      <div className="dialog dialog-small" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`}>
        <h2 id={`${id}-t`}>{title}</h2>
        {dialog.kind === "rename" && (
          <>
            <label htmlFor={`${id}-n`} className="dialog-label">New name</label>
            <input id={`${id}-n`} autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) void run(); }} />
            <p className="muted">{count(g.items)} will change to the new name.</p>
          </>
        )}
        {dialog.kind === "merge" && (
          <>
            <label htmlFor={`${id}-t2`} className="dialog-label">Move its initiatives to</label>
            <select id={`${id}-t2`} autoFocus value={target} onChange={(e) => setTarget(e.target.value)}>
              {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <p className="muted">{count(g.items)} will move. “{g.name}” is removed. You can undo this right after.</p>
          </>
        )}
        {dialog.kind === "retire" && <p className="muted">No initiative uses this group. It will no longer be offered when typing.</p>}
        {err && <p role="alert" className="quick-add-error">{err}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy || (dialog.kind === "rename" && name.trim() === "") || (dialog.kind === "merge" && !target)} onClick={() => void run()}>
            {dialog.kind === "rename" ? "Rename" : dialog.kind === "merge" ? "Merge groups" : "Retire group"}
          </button>
        </div>
      </div>
    </div>
  );
}
