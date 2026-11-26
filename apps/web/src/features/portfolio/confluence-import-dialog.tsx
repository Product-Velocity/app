"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DOC_KINDS, DOC_KIND_LABEL, type DocKind } from "@pv/domain";
import { ConfluencePageTree } from "./confluence-page-tree";

type ImportPreview = {
  title: string; kind: DocKind; mode: "once" | "sync"; page: { id: string; url: string | null; version: number; spaceKey: string };
  excerpt: string; truncated: boolean; characters: number; lost: string[]; notes: string[]; confirm: string;
};
type RefreshPreview = {
  action: "unchanged" | "update" | "gone"; why: string; localEdits: boolean; page: { version: number; title: string; url: string | null } | null;
  excerpt: string; truncated: boolean; characters: number; lost: string[]; notes: string[]; confirm: string;
};
type Done = { message: string; page?: { url: string | null; version: number } };

/**
 * Reading a Confluence page into Product Velocity (issue #693 slice A2). Two uses of one dialog: IMPORT makes a new document from a page address, REFRESH checks a
 * document that is kept from a page for a newer version. Both show a preview first (the converted text and what could not be carried over) and write only after
 * a confirmation; the page is only ever read, never written. A document created here is "Do not share" until a person decides.
 */
export function ConfluenceImportDialog({ mode, itemId, doc, prefill, onClose, onChanged }: {
  mode: "import" | "refresh";
  itemId: string;
  /** The document to refresh (mode refresh). */
  doc?: { id: string; title: string };
  /** An address and kind to start from (a link the person already has on the initiative). */
  prefill?: { pageUrl?: string; kind?: DocKind };
  onClose: () => void;
  onChanged: () => void;
}) {
  const titleId = useId();
  const firstRef = useRef<HTMLInputElement>(null);
  const [pageUrl, setPageUrl] = useState(prefill?.pageUrl ?? "");
  const [kind, setKind] = useState<DocKind>(prefill?.kind ?? "other");
  const [after, setAfter] = useState<"sync" | "once">("sync");
  const [twoWay, setTwoWay] = useState(false); // with "keep in sync": also write the document back to the page (issue #714)
  const [title, setTitle] = useState("");
  const [imp, setImp] = useState<ImportPreview | null>(null);
  const [ref, setRef] = useState<RefreshPreview | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // choosing the page by browsing instead of pasting its address
  const [browse, setBrowse] = useState<{ spaces: { key: string; name: string }[]; siteUrl: string } | "loading" | null>(null);
  const [space, setSpace] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const openBrowse = async () => {
    setBrowse("loading"); setError(null);
    try {
      const r = await fetch(`/api/documents/import-confluence/pages?item=${encodeURIComponent(itemId)}&spaces=1`);
      const j = (await r.json().catch(() => ({}))) as { spaces?: { key: string; name: string }[]; siteUrl?: string; error?: string };
      if (!r.ok || !j.spaces || !j.siteUrl) { setBrowse(null); setError(j.error ?? "Confluence could not be read."); return; }
      setBrowse({ spaces: j.spaces, siteUrl: j.siteUrl }); setSpace(j.spaces[0]?.key ?? "");
    } catch { setBrowse(null); setError("Product Velocity could not be reached."); }
  };

  const post = async (url: string, body: Record<string, unknown>) => {
    setBusy(true); setError(null);
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
      if (!r.ok) { setError(j.error ?? "That did not work. Nothing was changed."); return null; }
      return j;
    } catch { setError("Product Velocity could not be reached. Nothing was changed."); return null; } finally { setBusy(false); }
  };
  const docUrl = doc ? `/api/documents/${doc.id}/confluence` : "";
  const importBody = (extra: Record<string, unknown> = {}) => ({ item: itemId, pageUrl: pageUrl.trim(), kind, mode: after, ...(after === "sync" ? { direction: twoWay ? "both" : "from_confluence" } : {}), ...(title.trim() ? { title: title.trim() } : {}), ...extra });

  useEffect(() => { firstRef.current?.focus(); }, []);
  // a refresh starts by reading the page: the person only decides after seeing what changed
  useEffect(() => {
    if (mode !== "refresh" || !doc) return;
    let live = true;
    void (async () => {
      const j = await post(docUrl, { action: "refresh-preview" });
      if (live && j?.refresh) setRef(j.refresh as RefreshPreview);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, doc?.id]);

  const doImportPreview = async () => { setImp(null); const j = await post("/api/documents/import-confluence", { action: "preview", ...importBody() }); if (j?.preview) setImp(j.preview as ImportPreview); };
  const doImport = async () => { if (!imp) return; const j = await post("/api/documents/import-confluence", { action: "import", ...importBody({ confirm: imp.confirm }) }); if (j?.done) { setDone(j.done as Done); onChanged(); } };
  const doRefresh = async (overwrite: boolean) => { if (!ref) return; const j = await post(docUrl, { action: "refresh", confirm: ref.confirm, ...(overwrite ? { overwrite: true } : {}) }); if (j?.done) { setDone(j.done as Done); onChanged(); } };

  const excerpt = (text: string, truncated: boolean) => (
    <pre className="import-excerpt" tabIndex={0} aria-label="The text that would be copied (start)">{text}{truncated ? "\n…" : ""}</pre>
  );
  const lost = (l: string[]) => l.length > 0 && <div role="status" className="notice"><strong>Not carried over.</strong> {l.join(" ")}</div>;

  return (
    <div className="dialog-backdrop" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div className="dialog dialog-narrow" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{mode === "import" ? "Read a Confluence page into a document" : `Check Confluence for changes: ${doc?.title ?? ""}`}</h2>
        {done ? (
          <>
            <p role="status">{done.message}{done.page?.url && <> <a href={done.page.url} target="_blank" rel="noopener noreferrer">Open the page</a>.</>}</p>
            <div className="dialog-actions"><button type="button" className="btn btn-primary" onClick={onClose}>Close</button></div>
          </>
        ) : (
          <>
            {mode === "import" && (
              <>
                <p className="muted">The text of the page is copied into a new document; the page stays where it is and is never changed. The document is kept out of the tracker issue until you choose to share it. The conversion is not perfect (images, macros and merged cells do not carry over), and the preview says what was left out.</p>
                {browse === null && <p><button type="button" className="btn" disabled={busy} onClick={() => void openBrowse()}>Browse Confluence</button> <span className="muted">or paste the address of the page below.</span></p>}
                {browse === "loading" && <p role="status">Reading the spaces…</p>}
                {browse && browse !== "loading" && (
                  <>
                    <label className="dialog-label" htmlFor={`${titleId}-sp`}>Space</label>
                    <select id={`${titleId}-sp`} value={space} onChange={(e) => { setSpace(e.target.value); setChosen(null); setPageUrl(""); setImp(null); }}>
                      {browse.spaces.map((x) => <option key={x.key} value={x.key}>{x.name} ({x.key})</option>)}
                    </select>
                    {space && (
                      <ConfluencePageTree
                        key={space} pagesUrl={`/api/documents/import-confluence/pages?item=${encodeURIComponent(itemId)}`} spaceKey={space} label="Page to read" selectedId={chosen}
                        onSelect={(pg) => { setChosen(pg?.id ?? null); setPageUrl(pg ? `${browse.siteUrl}/wiki/pages/viewpage.action?pageId=${pg.id}` : ""); setImp(null); }}
                      />
                    )}
                  </>
                )}
                <label className="dialog-label" htmlFor={`${titleId}-u`}>Page address</label>
                <input id={`${titleId}-u`} ref={firstRef} type="url" placeholder="Paste the address of the Confluence page" value={pageUrl} onChange={(e) => { setPageUrl(e.target.value); setChosen(null); setImp(null); }} />
                <label className="dialog-label" htmlFor={`${titleId}-k`}>What kind of document is it</label>
                <select id={`${titleId}-k`} value={kind} onChange={(e) => { setKind(e.target.value as DocKind); setImp(null); }}>
                  {DOC_KINDS.map((k) => <option key={k} value={k}>{DOC_KIND_LABEL[k]}</option>)}
                </select>
                <label className="dialog-label" htmlFor={`${titleId}-t`}>Document title (optional, the page title when left out)</label>
                <input id={`${titleId}-t`} type="text" maxLength={200} value={title} onChange={(e) => { setTitle(e.target.value); setImp(null); }} />
                <fieldset className="dialog-row" style={{ border: 0, padding: 0 }}>
                  <legend className="dialog-label">After copying</legend>
                  <label><input type="radio" name={`${titleId}-m`} checked={after === "sync" && !twoWay} onChange={() => { setAfter("sync"); setTwoWay(false); setImp(null); }} /> Keep up to date from Confluence: you can check the page for changes and update the document from it (the page is never written)</label>
                  <label><input type="radio" name={`${titleId}-m`} checked={after === "sync" && twoWay} onChange={() => { setAfter("sync"); setTwoWay(true); setImp(null); }} /> Both ways: also write changes made here back to the page (you confirm each time; a change on both sides is yours to settle)</label>
                  <label><input type="radio" name={`${titleId}-m`} checked={after === "once"} onChange={() => { setAfter("once"); setImp(null); }} /> Once: copy the text now, then let go of the page</label>
                </fieldset>
              </>
            )}
            {mode === "refresh" && !ref && !error && <p role="status">Reading the page…</p>}
            {error && <p role="alert" className="error">{error}</p>}

            {imp && (
              <div className="stack" role="region" aria-label="Preview">
                <h3>Preview</h3>
                <p><strong>{imp.title}</strong> · {DOC_KIND_LABEL[imp.kind]} · page version {imp.page.version} in space {imp.page.spaceKey} · {imp.characters.toLocaleString("en")} characters.</p>
                {excerpt(imp.excerpt, imp.truncated)}
                {lost(imp.lost)}
                {imp.notes.map((n) => <p key={n} className="muted">{n}</p>)}
              </div>
            )}
            {ref && (
              <div className="stack" role="region" aria-label="What changed">
                <p><strong>{ref.action === "unchanged" ? "Nothing to update" : ref.action === "gone" ? "The page is gone" : "The page has a newer version"}</strong>: {ref.why}</p>
                {ref.action === "update" && excerpt(ref.excerpt, ref.truncated)}
                {lost(ref.lost)}
                {ref.localEdits && ref.action === "update" && <div role="alert" className="notice"><strong>Edited here.</strong> The document was changed in Product Velocity since it was last updated from the page.</div>}
                {ref.notes.map((n) => <p key={n} className="muted">{n}</p>)}
              </div>
            )}

            <div className="dialog-actions">
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              {mode === "import" && <button type="button" className="btn" disabled={busy || !pageUrl.trim()} onClick={() => void doImportPreview()}>{busy && !imp ? "Reading…" : "Preview"}</button>}
              {mode === "import" && imp && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void doImport()}>{busy ? "Copying…" : "Confirm: copy the text into a new document"}</button>}
              {mode === "refresh" && ref?.action === "update" && !ref.localEdits && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void doRefresh(false)}>{busy ? "Updating…" : "Confirm: update the document"}</button>}
              {mode === "refresh" && ref?.action === "update" && ref.localEdits && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void doRefresh(true)}>{busy ? "Updating…" : "Replace with the Confluence version"}</button>}
              {mode === "refresh" && ref?.action === "gone" && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void doRefresh(false)}>{busy ? "Working…" : "Stop linking"}</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
