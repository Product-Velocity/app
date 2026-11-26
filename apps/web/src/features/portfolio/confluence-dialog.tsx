"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ConfluenceView } from "@/lib/documents";

type Space = { key: string; name: string; type: string };
type Status = { canPublish: boolean; available: boolean; site: { name: string; url: string } | null; last: (ConfluenceView & { pageUrl: string }) | null; spaces?: Space[]; error?: string };
type Warning = { kind: string; what: string };
type Preview = {
  action: "create" | "update" | "none" | "conflict" | "gone"; why: string; mode: "once" | "sync"; title: string; spaceKey: string;
  parent: { id: string; title: string } | null; page: { id: string; url: string | null; version: number } | null; warnings: Warning[]; notes: string[]; confirm: string;
};
type Done = { action: string; page: { url: string | null; version: number } | null; message: string };

const WARNING_WORD: Record<string, string> = { customer: "A customer", key_result: "A key result", value: "The business value", money: "An amount of money" };

/**
 * "Publish to Confluence": one document to one page, in two steps. The preview says exactly what would happen (a new page, a new version of the page,
 * nothing, or a conflict because somebody saved the page in Confluence), warns about commercial text, and writes nothing. Only "Confirm" writes, and only
 * what was previewed. Page permissions stay in Confluence. Claude can prepare this; a person confirms (CLAUDE.md rule 3).
 */
export function ConfluenceDialog({ doc, onClose, onChanged }: { doc: { id: string; title: string; version: number; aiDraft: boolean }; onClose: () => void; onChanged: () => void }) {
  const titleId = useId();
  const firstRef = useRef<HTMLSelectElement>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [space, setSpace] = useState("");
  const [parentUrl, setParentUrl] = useState("");
  const [title, setTitle] = useState(doc.title);
  const [mode, setMode] = useState<"sync" | "once">("sync");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void fetch(`/api/documents/${doc.id}/confluence?spaces=1`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((s: Status) => { if (live) { setStatus(s); setSpace(s.spaces?.[0]?.key ?? ""); if (s.last?.linked) setMode(s.last.syncMode); } })
      .catch(() => { if (live) setLoadError("Confluence could not be reached from here. Try again in a moment."); });
    return () => { live = false; };
  }, [doc.id]);
  useEffect(() => { firstRef.current?.focus(); }, [status]);

  const linked = status?.last?.linked ? status.last : null;
  const call = async (action: "preview" | "publish" | "unlink", extra: Record<string, unknown> = {}) => {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/documents/${doc.id}/confluence`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, mode, ...(linked ? {} : { spaceKey: space, parentUrl: parentUrl.trim() || undefined }), title: title.trim() || undefined, ...extra }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; preview?: Preview; done?: Done; ok?: boolean };
      if (!r.ok) { setError(j.error ?? "That did not work. Nothing was written."); return null; }
      return j;
    } catch {
      setError("Product Velocity could not be reached. Nothing was written.");
      return null;
    } finally { setBusy(false); }
  };
  const doPreview = async () => { setPreview(null); const j = await call("preview"); if (j?.preview) setPreview(j.preview); };
  const doPublish = async (overwrite: boolean) => {
    if (!preview) return;
    const j = await call("publish", { confirm: preview.confirm, ...(overwrite ? { overwrite: true } : {}) });
    if (j?.done) { setDone(j.done); onChanged(); }
  };
  const doUnlink = async () => { const j = await call("unlink"); if (j?.ok) { onChanged(); onClose(); } };

  const noun = preview?.action === "create" || preview?.action === "gone" ? "Create the page" : "Update the page";
  return (
    <div className="dialog-backdrop" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div className="dialog dialog-narrow" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{linked ? "Update the Confluence page" : "Publish to Confluence"}: {doc.title}</h2>
        {loadError && <p role="alert" className="error">{loadError}</p>}
        {!status && !loadError && <p role="status">Checking Confluence…</p>}
        {status && !status.available && (
          <p role="alert" className="notice">Confluence is not connected for this workspace. A workspace admin can add it under Settings, Integrations, Jira (“Add Confluence”). Nothing can be published until then.</p>
        )}
        {status && status.available && !status.canPublish && <p role="alert" className="notice">Only a Creator or Admin can publish a document to Confluence.</p>}

        {status && status.available && status.canPublish && done && (
          <>
            <p role="status">{done.message}{done.page?.url && <> <a href={done.page.url} target="_blank" rel="noopener noreferrer">Open the page</a>{done.page.version > 1 ? ` (page version ${done.page.version})` : ""}.</>}</p>
            {mode === "once" && <p className="muted">The link has ended, as chosen: Product Velocity will not touch this page again.</p>}
            <div className="dialog-actions"><button type="button" className="btn btn-primary" onClick={onClose}>Close</button></div>
          </>
        )}

        {status && status.available && status.canPublish && !done && (
          <>
            <p className="muted">Site: {status.site?.name}. Product Velocity writes the page only after you confirm a preview, and the page says it is managed in Product Velocity. <strong>Page permissions are not managed here</strong>: anyone who can see the space can read the page.</p>
            {status.error && <p role="alert" className="notice">{status.error}</p>}
            {linked ? (
              <p>This document is on <a href={linked.pageUrl} target="_blank" rel="noopener noreferrer">{linked.pageTitle || "a Confluence page"}</a> in space {linked.spaceKey}. The page holds version {linked.publishedVersion}; the document is at version {doc.version}.{linked.outOfDate ? " The page is out of date." : ""}</p>
            ) : (
              <>
                <label className="dialog-label" htmlFor={`${titleId}-s`}>Space</label>
                <select id={`${titleId}-s`} ref={firstRef} value={space} onChange={(e) => { setSpace(e.target.value); setPreview(null); }}>
                  {(status.spaces ?? []).length === 0 && <option value="">No spaces found</option>}
                  {(status.spaces ?? []).map((s) => <option key={s.key} value={s.key}>{s.name} ({s.key})</option>)}
                </select>
                <label className="dialog-label" htmlFor={`${titleId}-p`}>Parent page (optional)</label>
                <input id={`${titleId}-p`} type="url" placeholder="Paste the address of the page it goes under" value={parentUrl} onChange={(e) => { setParentUrl(e.target.value); setPreview(null); }} />
              </>
            )}
            <label className="dialog-label" htmlFor={`${titleId}-t`}>Page title</label>
            <input id={`${titleId}-t`} type="text" maxLength={255} value={title} onChange={(e) => { setTitle(e.target.value); setPreview(null); }} />
            <fieldset className="dialog-row" style={{ border: 0, padding: 0 }}>
              <legend className="dialog-label">After publishing</legend>
              <label><input type="radio" name={`${titleId}-m`} checked={mode === "sync"} onChange={() => { setMode("sync"); setPreview(null); }} /> Keep in sync: when the document changes, update the page from here (you confirm each time)</label>
              <label><input type="radio" name={`${titleId}-m`} checked={mode === "once"} onChange={() => { setMode("once"); setPreview(null); }} /> Once: write the page now, then let go of it</label>
            </fieldset>

            {error && <p role="alert" className="error">{error}</p>}
            {preview && (
              <div className="stack" role="region" aria-label="Preview">
                <h3>Preview</h3>
                <p><strong>{preview.action === "create" ? "A new page will be created" : preview.action === "gone" ? "The old page is gone; a new page will be created" : preview.action === "update" ? "The page will be updated" : preview.action === "conflict" ? "The page was changed in Confluence" : "Nothing to publish"}</strong>{preview.action === "create" ? "." : `: ${preview.why}`}</p>
                <p className="muted">Title “{preview.title}”, space {preview.spaceKey}{preview.parent ? `, under “${preview.parent.title}”` : ""}.{preview.page?.url && <> <a href={preview.page.url} target="_blank" rel="noopener noreferrer">Current page</a>.</>}</p>
                {preview.warnings.length > 0 && (
                  <div role="alert" className="notice">
                    <strong>This text may be commercial.</strong> Confluence is your own site, but check who can read the page: {preview.warnings.map((w) => `${WARNING_WORD[w.kind] ?? "Something"} (${w.what})`).join("; ")}.
                  </div>
                )}
                {preview.notes.map((n) => <p key={n} className="muted">{n}</p>)}
              </div>
            )}

            <div className="dialog-actions">
              {linked && <button type="button" className="btn btn-danger-quiet" disabled={busy} onClick={() => void doUnlink()}>Stop linking</button>}
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="button" className="btn" disabled={busy || (!linked && !space)} onClick={() => void doPreview()}>{busy && !preview ? "Checking…" : "Preview"}</button>
              {preview && preview.action !== "none" && preview.action !== "conflict" && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void doPublish(false)}>{busy ? "Writing…" : `Confirm: ${noun}`}</button>}
              {preview && preview.action === "conflict" && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void doPublish(true)}>{busy ? "Writing…" : "Keep Product Velocity: replace the page"}</button>}
              {preview && preview.action === "none" && mode !== (linked?.syncMode ?? mode) && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void doPublish(false)}>Confirm</button>}
            </div>
          </>
        )}
        {status && status.available && !status.canPublish && <div className="dialog-actions"><button type="button" className="btn" onClick={onClose}>Close</button></div>}
        {status && !status.available && <div className="dialog-actions"><button type="button" className="btn" onClick={onClose}>Close</button></div>}
      </div>
    </div>
  );
}
