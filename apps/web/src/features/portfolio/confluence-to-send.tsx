"use client";

import { useEffect, useState } from "react";

type ToSend = { id: string; itemId: string; code: string; itemName: string; title: string; version: number; publishedVersion: number; pageTitle: string; pageUrl: string; spaceKey: string };
type Warning = { kind: string; what: string };
type Preview = { action: "create" | "update" | "none" | "conflict" | "gone"; why: string; title: string; warnings: Warning[]; notes: string[]; confirm: string };
type Row = { preview?: Preview; busy?: boolean; error?: string; done?: string };

const WARNING_WORD: Record<string, string> = { customer: "A customer", key_result: "A key result", value: "The business value", money: "An amount of money" };

/**
 * "To send" for Confluence in the Sync dialog (issue #693): documents kept in sync with a Confluence page whose document is newer than the page. Each one is its own
 * step, like the tracker updates: Preview shows what would be written (and warns about commercial text), and only "Confirm" updates the page, using the token of that
 * preview. Nothing is sent by the dialog's own "Apply and send": Confluence is a different place with its own confirmation. A page changed in Confluence meanwhile
 * (a conflict) or deleted is left to the document's menu, where the person can choose what to do.
 */
export function ConfluenceToSend({ itemIds, show, onSent }: { itemIds: string[]; /** false while the filter hides it (the list is still loaded). */ show: boolean; onSent?: () => void }) {
  const [docs, setDocs] = useState<ToSend[]>([]);
  const [rows, setRows] = useState<Record<string, Row>>({});

  useEffect(() => {
    let live = true;
    if (itemIds.length === 0 || itemIds.length > 200) return;
    void fetch(`/api/confluence/to-send?items=${itemIds.map(encodeURIComponent).join(",")}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { available?: boolean; documents?: ToSend[] } | null) => { if (live && j?.available && j.documents) setDocs(j.documents); })
      .catch(() => { /* the tracker part of the sync works without it */ });
    return () => { live = false; };
  }, [itemIds]);

  const set = (id: string, patch: Row) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  const call = async (id: string, body: Record<string, unknown>) => {
    set(id, { busy: true, error: "" });
    try {
      const r = await fetch(`/api/documents/${id}/confluence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "sync", ...body }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string; preview?: Preview; done?: { message: string } };
      if (!r.ok) { set(id, { busy: false, error: j.error ?? "That did not work. Nothing was written." }); return null; }
      return j;
    } catch { set(id, { busy: false, error: "Product Velocity could not be reached. Nothing was written." }); return null; }
  };
  const preview = async (id: string) => { const j = await call(id, { action: "preview" }); if (j?.preview) set(id, { busy: false, preview: j.preview }); };
  const confirm = async (id: string) => {
    const p = rows[id]?.preview;
    if (!p) return;
    const j = await call(id, { action: "publish", confirm: p.confirm });
    if (j?.done) { set(id, { busy: false, done: j.done.message, preview: undefined as never }); onSent?.(); }
  };

  const open = docs.filter((d) => !rows[d.id]?.done);
  if (docs.length === 0 || !show) return null;
  return (
    <section aria-label="Confluence pages to update">
      <h3>Confluence pages to update ({open.length})</h3>
      <p className="muted">These documents are kept in sync with a Confluence page and are newer than the page. Each update is its own step: preview it, then confirm. Nothing is written to Confluence by “Apply and send”.</p>
      <ul className="push-list" aria-label="Confluence pages to update">
        {docs.map((d) => {
          const r = rows[d.id] ?? {};
          return (
            <li key={d.id}>
              <strong>{d.code}</strong> {d.itemName} · {d.title} · <span className="push-pill">{r.done ? "Updated" : "To send"}</span>{" "}
              <a href={d.pageUrl} target="_blank" rel="noopener noreferrer">{d.pageTitle || "the page"}</a> <span className="muted">(space {d.spaceKey}; the page holds version {d.publishedVersion}, the document is at version {d.version})</span>
              {r.done && <><br /><span role="status">{r.done}</span></>}
              {r.error && <><br /><span role="alert" className="error">{r.error}</span></>}
              {!r.done && !r.preview && <> <button type="button" className="btn" disabled={r.busy} onClick={() => void preview(d.id)}>{r.busy ? "Checking…" : "Preview the update"}</button></>}
              {!r.done && r.preview && (
                <div role="region" aria-label={`Preview for ${d.code} ${d.title}`}>
                  <p><strong>{r.preview.action === "update" ? "The page will be updated" : r.preview.action === "none" ? "Nothing to publish" : r.preview.action === "conflict" ? "The page was changed in Confluence" : "The page is gone"}</strong>{r.preview.action === "update" ? "." : `: ${r.preview.why}`}</p>
                  {r.preview.warnings.length > 0 && <p role="alert" className="notice"><strong>This text may be commercial.</strong> Check who can read the page: {r.preview.warnings.map((w) => `${WARNING_WORD[w.kind] ?? "Something"} (${w.what})`).join("; ")}.</p>}
                  {r.preview.notes.map((n) => <p key={n} className="muted">{n}</p>)}
                  {r.preview.action === "update" && <button type="button" className="btn btn-primary" disabled={r.busy} onClick={() => void confirm(d.id)}>{r.busy ? "Writing…" : "Confirm: update the page"}</button>}
                  {(r.preview.action === "conflict" || r.preview.action === "gone") && <p className="muted">Open the document’s menu on the Spec tab (Update the Confluence page) to decide what to do.</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
