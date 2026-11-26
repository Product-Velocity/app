"use client";

import { useEffect, useState } from "react";

type ToSend = { id: string; itemId: string; code: string; itemName: string; title: string; version: number; publishedVersion: number; pageTitle: string; pageUrl: string; spaceKey: string; direction: "from_confluence" | "to_confluence" | "both"; state: "send" | "receive" | "conflict" | "gone"; pageVersion: number | "missing" | null };
type Refresh = { action: "unchanged" | "update" | "gone"; why: string; localEdits: boolean; excerpt: string; truncated: boolean; lost: string[]; notes: string[]; confirm: string };
type Warning = { kind: string; what: string };
type Preview = { action: "create" | "update" | "none" | "conflict" | "gone"; why: string; title: string; warnings: Warning[]; notes: string[]; confirm: string };
type Row = { preview?: Preview; refresh?: Refresh; busy?: boolean; error?: string; done?: string };

const WARNING_WORD: Record<string, string> = { customer: "A customer", key_result: "A key result", value: "The business value", money: "An amount of money" };

/**
 * Confluence in the Sync dialog (issue #693, #714): documents kept up to date with a Confluence page that need something: to SEND (the document is newer than the page),
 * to RECEIVE (the page is newer than the document, for a link that reads or goes both ways) or a CONFLICT (both changed). Each one is its own
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
      const j = (await r.json().catch(() => ({}))) as { error?: string; preview?: Preview; refresh?: Refresh; done?: { message: string } };
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
  // receive: read the page again, show what would come in, and only Confirm changes the document (the old text stays as a previous version)
  const previewReceive = async (id: string) => { const j = await call(id, { action: "refresh-preview" }); const r = (j as unknown as { refresh?: Refresh } | null)?.refresh; if (r) set(id, { busy: false, refresh: r }); };
  const confirmReceive = async (id: string) => {
    const r = rows[id]?.refresh;
    if (!r) return;
    const j = await call(id, { action: "refresh", confirm: r.confirm });
    if (j?.done) { set(id, { busy: false, done: j.done.message, refresh: undefined as never }); onSent?.(); }
  };

  const open = docs.filter((d) => !rows[d.id]?.done);
  if (docs.length === 0 || !show) return null;
  return (
    <section aria-label="Confluence pages to update">
      <h3>Confluence pages to update ({open.length})</h3>
      <p className="muted">These documents are kept up to date with a Confluence page, and one side has changes the other lacks. Each update is its own step, in either direction: preview it, then confirm. Nothing is written to Confluence by “Apply and send”.</p>
      <ul className="push-list" aria-label="Confluence pages to update">
        {docs.map((d) => {
          const r = rows[d.id] ?? {};
          return (
            <li key={d.id}>
              <strong>{d.code}</strong> {d.itemName} · {d.title} · <span className="push-pill">{r.done ? "Updated" : d.state === "receive" ? "To receive" : d.state === "conflict" ? "Conflict" : d.state === "gone" ? "Page gone" : "To send"}</span>{" "}
              <a href={d.pageUrl} target="_blank" rel="noopener noreferrer">{d.pageTitle || "the page"}</a>{" "}
              <span className="muted">(space {d.spaceKey}; {d.direction === "both" ? "both ways" : d.direction === "from_confluence" ? "read from Confluence" : "written to Confluence"}; {d.state === "send" ? `the page holds version ${d.publishedVersion}, the document is at version ${d.version}` : d.state === "receive" ? `the page is at version ${d.pageVersion}, newer than the document’s last update from it` : d.state === "conflict" ? `the document is at version ${d.version} (page written from ${d.publishedVersion}) and the page is at version ${d.pageVersion}` : "the page was deleted or can no longer be seen"})</span>
              {r.done && <><br /><span role="status">{r.done}</span></>}
              {r.error && <><br /><span role="alert" className="error">{r.error}</span></>}
              {!r.done && d.state === "send" && !r.preview && <> <button type="button" className="btn" disabled={r.busy} onClick={() => void preview(d.id)}>{r.busy ? "Checking…" : "Preview the update"}</button></>}
              {!r.done && d.state === "receive" && !r.refresh && <> <button type="button" className="btn" disabled={r.busy} onClick={() => void previewReceive(d.id)}>{r.busy ? "Reading the page…" : "Preview what comes in"}</button></>}
              {!r.done && (d.state === "conflict" || d.state === "gone") && <><br /><span className="muted">{d.state === "conflict" ? "Both sides changed, so you choose which to keep." : "Decide whether to make a new page or stop linking."} Open the document’s menu on the Spec tab (Confluence sync).</span></>}
              {!r.done && r.preview && (
                <div role="region" aria-label={`Preview for ${d.code} ${d.title}`}>
                  <p><strong>{r.preview.action === "update" ? "The page will be updated" : r.preview.action === "none" ? "Nothing to publish" : r.preview.action === "conflict" ? "The page was changed in Confluence" : "The page is gone"}</strong>{r.preview.action === "update" ? "." : `: ${r.preview.why}`}</p>
                  {r.preview.warnings.length > 0 && <p role="alert" className="notice"><strong>This text may be commercial.</strong> Check who can read the page: {r.preview.warnings.map((w) => `${WARNING_WORD[w.kind] ?? "Something"} (${w.what})`).join("; ")}.</p>}
                  {r.preview.notes.map((n) => <p key={n} className="muted">{n}</p>)}
                  {r.preview.action === "update" && <button type="button" className="btn btn-primary" disabled={r.busy} onClick={() => void confirm(d.id)}>{r.busy ? "Writing…" : "Confirm: update the page"}</button>}
                  {(r.preview.action === "conflict" || r.preview.action === "gone") && <p className="muted">Open the document’s menu on the Spec tab (Confluence sync) to decide what to do.</p>}
                </div>
              )}
              {!r.done && r.refresh && (
                <div role="region" aria-label={`What comes in for ${d.code} ${d.title}`}>
                  <p><strong>{r.refresh.action === "update" ? "The document will be updated from the page" : r.refresh.action === "unchanged" ? "Nothing to update" : "The page is gone"}</strong>{r.refresh.action === "update" ? "." : `: ${r.refresh.why}`}</p>
                  {r.refresh.action === "update" && <pre className="import-excerpt" tabIndex={0} aria-label="The text that would come in (start)">{r.refresh.excerpt}{r.refresh.truncated ? "\n…" : ""}</pre>}
                  {r.refresh.lost.length > 0 && <p role="status" className="notice"><strong>Not carried over.</strong> {r.refresh.lost.join(" ")}</p>}
                  {r.refresh.notes.map((n) => <p key={n} className="muted">{n}</p>)}
                  {r.refresh.action === "update" && !r.refresh.localEdits && <button type="button" className="btn btn-primary" disabled={r.busy} onClick={() => void confirmReceive(d.id)}>{r.busy ? "Updating…" : "Confirm: update the document"}</button>}
                  {r.refresh.localEdits && r.refresh.action === "update" && <p role="alert" className="notice">The document was also changed here, so this is a conflict. Open the document’s menu on the Spec tab (Confluence sync) to choose which side to keep.</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
