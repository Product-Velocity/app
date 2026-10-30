"use client";

import { useCallback, useEffect, useState } from "react";
import { AI_TOOL_LABEL, DOC_KIND_LABEL, DOC_KINDS, MAX_DOC_CHARS, MAX_DOCS_PER_ITEM } from "@pv/domain";
import type { DocView } from "@/lib/documents";
import { MarkdownPreview } from "./markdown-preview";

type Version = { version: number; saved_at: string; saved_via: string; ai_tool?: string | null; ai_model?: string | null; saved_by_name?: string | null };
/** "Claude (Claude Opus 5.5)": the AI tool from the connection and the model the assistant stated. */
const aiLabel = (tool?: string | null, model?: string | null) => (tool ? `${AI_TOOL_LABEL[tool] ?? tool}${model ? ` (${model})` : ""}` : null);
const STATUS_LABEL: Record<string, string> = { draft: "Draft", in_review: "In review", approved: "Approved" };

/**
 * The Spec tab: the documents of one initiative (the full PRD, requirements, research). Versioned Markdown that stays in Product Velocity:
 * it is never written to GitHub. Saves on leaving a box, keeps every version (restoring one is the undo), and never overwrites a newer save.
 */
export function DocumentsTab({ itemId, canEdit }: { itemId: string; canEdit: boolean }) {
  const [docs, setDocs] = useState<DocView[] | null>(null);
  // a link from the activity log opens the document: ?item=R-12&tab=spec&doc=<id>
  const [openId, setOpenId] = useState<string | null>(() => {
    const d = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("doc");
    return d && /^[0-9a-f-]{36}$/i.test(d) ? d : null;
  });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/documents?item=${encodeURIComponent(itemId)}`);
      if (!r.ok) throw new Error();
      setDocs(((await r.json()) as { documents: DocView[] }).documents);
    } catch {
      setDocs([]);
      setError("Documents could not be loaded.");
    }
  }, [itemId]);
  useEffect(() => {
    let live = true;
    void fetch(`/api/documents?item=${encodeURIComponent(itemId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { documents: DocView[] }) => { if (live) setDocs(d.documents); })
      .catch(() => { if (live) { setDocs([]); setError("Documents could not be loaded."); } });
    return () => { live = false; };
  }, [itemId]);

  const create = async () => {
    setError(null);
    const r = await fetch("/api/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item: itemId, kind: "prd", title: "PRD", body: "" }) });
    const body = (await r.json().catch(() => ({}))) as { document?: DocView; error?: string };
    if (!r.ok || !body.document) { setError(body.error ?? "The document could not be created."); return; }
    await load();
    setOpenId(body.document.id);
  };

  if (!docs) return <p className="muted" role="status">Loading…</p>;
  return (
    <div className="docs">
      <h3>Documents</h3>
      <p className="muted">The full PRD and other long documents live here. They stay in Product Velocity and are never written to GitHub. What builders need goes in the Description on the Overview tab.</p>
      {error && <p role="alert" className="pf-error">{error}</p>}
      {docs.length === 0 && <p className="muted">No documents yet.</p>}
      <ul className="docs-list">
        {docs.map((d) => (
          <li key={d.id} className="docs-row" data-doc={d.title}>
            <button type="button" className="btn" aria-expanded={openId === d.id} onClick={() => setOpenId(openId === d.id ? null : d.id)}>{d.title}</button>
            <span className="muted"> {DOC_KIND_LABEL[d.kind as keyof typeof DOC_KIND_LABEL] ?? d.kind} · version {d.version} · {STATUS_LABEL[d.status] ?? d.status}{d.aiDraft ? " · AI draft, needs review" : ""}{aiLabel(d.aiTool, d.aiModel) ? ` · written with ${aiLabel(d.aiTool, d.aiModel)}` : ""}</span>
            {openId === d.id && <DocEditor id={d.id} canEdit={canEdit} onChanged={load} onRemoved={() => { setOpenId(null); void load(); }} onError={setError} />}
          </li>
        ))}
      </ul>
      {canEdit && <button type="button" className="btn" disabled={docs.length >= MAX_DOCS_PER_ITEM} onClick={() => void create()}>Add document</button>}
    </div>
  );
}

function DocEditor({ id, canEdit, onChanged, onRemoved, onError }: { id: string; canEdit: boolean; onChanged: () => Promise<void>; onRemoved: () => void; onError: (e: string | null) => void }) {
  const [doc, setDoc] = useState<DocView | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState(false);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [viewing, setViewing] = useState<{ version: number; title: string; body: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const apply = useCallback((d: DocView) => { setDoc(d); setTitle(d.title); setBody(d.body ?? ""); }, []);
  useEffect(() => {
    let live = true;
    void fetch(`/api/documents/${id}?versions=1`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { document: DocView; versions: Version[] }) => { if (live) { apply(d.document); setVersions(d.versions); } })
      .catch(() => { if (live) onError("The document could not be opened."); });
    return () => { live = false; };
  }, [id, apply, onError]);

  const save = async (patch: Record<string, unknown>) => {
    if (!doc) return;
    onError(null);
    const r = await fetch(`/api/documents/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseVersion: doc.version, ...patch }) });
    const out = (await r.json().catch(() => ({}))) as { document?: DocView; current?: DocView; error?: string };
    if (r.ok && out.document) {
      apply(out.document);
      setNote(`Saved as version ${out.document.version}.`);
      const v = await fetch(`/api/documents/${id}?versions=1`).then((x) => x.json()).catch(() => null) as { versions?: Version[] } | null;
      if (v?.versions) setVersions(v.versions);
      await onChanged();
      return;
    }
    if (r.status === 409 && out.current) {
      apply(out.current); // show the newer text; the person's unsaved box is replaced, so say so
      setNote(null);
      onError(`${out.error} The newer text is shown; copy anything you still need from your edit.`);
      return;
    }
    onError(out.error ?? "The document could not be saved.");
  };

  const remove = async () => {
    if (!window.confirm(`Remove the document "${doc?.title}" and all its versions? This cannot be undone.`)) return;
    const r = await fetch(`/api/documents/${id}`, { method: "DELETE" });
    if (r.ok) onRemoved(); else onError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "The document could not be removed.");
  };

  const showVersion = async (n: number) => {
    const r = await fetch(`/api/documents/${id}?version=${n}`);
    const out = (await r.json().catch(() => ({}))) as { version?: { version: number; title: string; body: string } };
    if (r.ok && out.version) setViewing(out.version);
  };

  if (!doc) return <p className="muted" role="status">Opening…</p>;
  const ro = !canEdit;
  return (
    <div className="docs-editor">
      <div className="docs-meta">
        <label>Title <input value={title} disabled={ro} maxLength={200} onChange={(e) => setTitle(e.target.value)} onBlur={() => { if (title.trim() && title !== doc.title) void save({ title }); }} /></label>
        <label>Kind{" "}
          <select value={doc.kind} disabled={ro} onChange={(e) => void save({ kind: e.target.value })}>
            {DOC_KINDS.map((k) => <option key={k} value={k}>{DOC_KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label>Status{" "}
          <select value={doc.status} disabled={ro || doc.status === "approved"} onChange={(e) => void save({ status: e.target.value })}>
            <option value="draft">Draft</option>
            <option value="in_review">In review</option>
            {doc.status === "approved" && <option value="approved">Approved</option>}
          </select>
        </label>
      </div>
      <p className="muted">
        {doc.status === "approved" ? "Approved. Changing the text sends it back to review." : "Approval happens when the initiative moves from Design to Build, by a person with the Approver permission."}
        {doc.aiDraft && <> This document was written by {aiLabel(doc.aiTool, doc.aiModel) ?? "an AI assistant"} and needs a person to accept it. {canEdit && <button type="button" className="btn" onClick={() => void save({ acceptDraft: true })}>Accept draft</button>}</>}
      </p>
      <div className="md-tabs" role="group" aria-label="Document view">
        <button type="button" className={preview ? "tool-btn" : "tool-btn tool-btn-on"} aria-pressed={!preview} onClick={() => setPreview(false)}>Write</button>
        <button type="button" className={preview ? "tool-btn tool-btn-on" : "tool-btn"} aria-pressed={preview} onClick={() => setPreview(true)}>Preview</button>
        <span className="muted md-count">{body.length.toLocaleString("en-GB")} of {MAX_DOC_CHARS.toLocaleString("en-GB")} characters · Markdown</span>
      </div>
      {preview ? <MarkdownPreview text={body} /> : (
        <textarea aria-label={`Text of ${doc.title}`} className="docs-text" rows={18} value={body} readOnly={ro} spellCheck maxLength={MAX_DOC_CHARS}
          onChange={(e) => setBody(e.target.value)} onBlur={() => { if (body !== (doc.body ?? "")) void save({ body }); }} />
      )}
      {note && <p role="status" className="muted">{note}</p>}
      {versions && versions.length > 0 && (
        <details className="docs-versions">
          <summary>Versions ({versions.length})</summary>
          <ul>
            {versions.map((v) => (
              <li key={v.version}>
                Version {v.version} · {new Date(v.saved_at).toLocaleString()} · {aiLabel(v.ai_tool, v.ai_model) ?? v.saved_by_name ?? v.saved_via}{" "}
                <button type="button" className="btn" onClick={() => void showVersion(v.version)}>{`View version ${v.version}`}</button>
              </li>
            ))}
          </ul>
          {viewing && (
            <div className="docs-viewing">
              <h4>Version {viewing.version}: {viewing.title}</h4>
              <MarkdownPreview text={viewing.body} />
              {canEdit && <button type="button" className="btn" onClick={() => { void save({ title: viewing.title, body: viewing.body }); setViewing(null); }}>{`Restore version ${viewing.version}`}</button>}
              <button type="button" className="btn" onClick={() => setViewing(null)}>Close</button>
            </div>
          )}
        </details>
      )}
      {canEdit && <p><button type="button" className="btn btn-danger" onClick={() => void remove()}>Remove document</button></p>}
    </div>
  );
}
