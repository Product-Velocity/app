"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { SYNC_DIRECTIONS, SYNC_DIRECTION_LABEL, type SyncDirection, type SyncState } from "@pv/domain";

type State = { direction: SyncDirection; state: SyncState; pageVersion: number | "missing" | null; documentVersion: number; publishedVersion: number };

/**
 * "Confluence sync" for a linked document (issue #714): which way the document and its page are kept up to date, and what each side has that the other does not
 * right now. The direction is a setting of a person; it never writes anything by itself. The state is read when the window opens (only the page's version number),
 * never in the background. Every write still goes through the preview and the confirmation of the dialogs this one opens, in either direction. A change on both
 * sides is a conflict: the person chooses which side to keep, and the other side's text stays as a previous version or in the page history.
 */
export function ConfluenceSyncDialog({ doc, onClose, onChanged, onUpdatePage, onUpdateDocument }: { doc: { id: string; title: string }; onClose: () => void; onChanged: () => void; onUpdatePage: () => void; onUpdateDocument: () => void }) {
  const titleId = useId();
  const [s, setS] = useState<State | null>(null);
  const [direction, setDirection] = useState<SyncDirection>("to_confluence");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const post = useCallback(async (body: Record<string, unknown>) => {
    const r = await fetch(`/api/documents/${doc.id}/confluence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
    return { ok: r.ok, j };
  }, [doc.id]);

  useEffect(() => {
    let live = true;
    void post({ action: "sync-state" })
      .then(({ ok, j }) => { if (!live) return; if (!ok) setError(j.error ?? "Confluence could not be checked."); else { setS(j as unknown as State); setDirection((j as unknown as State).direction); } })
      .catch(() => { if (live) setError("Product Velocity could not be reached."); });
    return () => { live = false; };
  }, [post]);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const { ok, j } = await post({ action: "set-direction", direction });
      if (!ok) { setError(j.error ?? "The direction could not be changed."); return; }
      onChanged();
      const again = await post({ action: "sync-state" });
      if (again.ok) setS(again.j as unknown as State);
    } catch { setError("Product Velocity could not be reached."); } finally { setBusy(false); }
  };

  const changed = s !== null && direction !== s.direction;
  const page = s && typeof s.pageVersion === "number" ? s.pageVersion : null;
  return (
    <div className="dialog-backdrop" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div className="dialog dialog-narrow" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>Confluence sync: {doc.title}</h2>
        {!s && !error && <p role="status">Checking the page…</p>}
        {error && <p role="alert" className="error">{error}</p>}
        {s && (
          <>
            <fieldset className="dialog-row" style={{ border: 0, padding: 0 }}>
              <legend className="dialog-label">Keep this document and its page up to date</legend>
              {SYNC_DIRECTIONS.map((d) => (
                <label key={d}><input type="radio" name={`${titleId}-d`} checked={direction === d} onChange={() => setDirection(d)} /> {SYNC_DIRECTION_LABEL[d]}</label>
              ))}
            </fieldset>
            <p className="muted">Nothing is written by this setting. In every direction a person previews and confirms each update, and the text it replaces is kept (a previous version of the document, or the page history in Confluence).</p>
            {changed && <div className="dialog-actions"><button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save the direction"}</button></div>}

            {!changed && (
              <div role="status" className="stack" aria-label="What each side has">
                {s.state === "in_step" && <p><strong>In step.</strong> {s.direction === "to_confluence" ? "The page holds the latest version of the document." : s.direction === "from_confluence" ? "The document holds the latest version of the page." : "Neither side has changes the other lacks."}</p>}
                {s.state === "send" && <p><strong>The document has changes the page does not.</strong> The page holds version {s.publishedVersion}; the document is at version {s.documentVersion}.</p>}
                {s.state === "receive" && <p><strong>The page has changes the document does not.</strong> The page is at version {page}.</p>}
                {s.state === "conflict" && <p role="alert" className="notice"><strong>Both sides changed since they were last in step.</strong> The document is at version {s.documentVersion} (the page was written from version {s.publishedVersion}) and the page is at version {page}. Choose which side to keep: the other side’s text is not lost (a previous version of the document, or the page history).</p>}
                {s.state === "gone" && <p role="alert" className="notice"><strong>The page is gone.</strong> It was deleted in Confluence, or this workspace’s sign-in can no longer see it. Where Product Velocity writes the page it can make a new one; otherwise stop linking.</p>}
                {s.state === "unknown" && <p role="alert" className="notice">The page could not be read just now, so nothing is known about it. Try again in a moment.</p>}
                {s.direction === "to_confluence" && s.state !== "gone" && <p className="muted">This direction does not read the page. A change made on the page itself is replaced by the next update.</p>}
                {s.direction === "from_confluence" && <p className="muted">This direction never writes to the page.</p>}
              </div>
            )}
          </>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Close</button>
          {s && !changed && s.state === "send" && <button type="button" className="btn btn-primary" onClick={onUpdatePage}>Update the page…</button>}
          {s && !changed && s.state === "gone" && s.direction !== "from_confluence" && <button type="button" className="btn btn-primary" onClick={onUpdatePage}>Make a new page…</button>}
          {s && !changed && s.state === "gone" && s.direction === "from_confluence" && <button type="button" className="btn btn-primary" onClick={onUpdateDocument}>Stop linking…</button>}
          {s && !changed && s.state === "receive" && <button type="button" className="btn btn-primary" onClick={onUpdateDocument}>Update the document from the page…</button>}
          {s && !changed && s.state === "conflict" && (
            <>
              <button type="button" className="btn" onClick={onUpdateDocument}>Keep Confluence: update the document…</button>
              <button type="button" className="btn" onClick={onUpdatePage}>Keep Product Velocity: update the page…</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
