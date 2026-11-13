"use client";

import { Loading } from "@/components/pill-loader";
import { useCallback, useEffect, useRef, useState } from "react";
import { AI_TOOL_LABEL, DOC_KIND_LABEL, DOC_KINDS, MAX_DOC_CHARS, MAX_DOCS_PER_ITEM } from "@pv/domain";
import type { DocView } from "@/lib/documents";
import { MarkdownPreview } from "./markdown-preview";
import { RowIcon, RowMenu, ShareChip } from "./attachment-ui";
import { FilesControl, type FilesHandle } from "./files-control";
import type { FieldCtx } from "./item-fields";
import { LinksList, type LinksHandle } from "./links-list";

type Version = { version: number; saved_at: string; saved_via: string; ai_tool?: string | null; ai_model?: string | null; saved_by_name?: string | null };
/** "Claude (Claude Opus 5.5)": the AI tool from the connection and the model the assistant stated. */
const aiLabel = (tool?: string | null, model?: string | null) => (tool ? `${AI_TOOL_LABEL[tool] ?? tool}${model ? ` (${model})` : ""}` : null);
const STATUS_LABEL: Record<string, string> = { draft: "Draft", in_review: "In review", approved: "Approved" };

/**
 * The Spec tab: the documents of one initiative (the full PRD, requirements, research). Versioned Markdown that stays in Product Velocity:
 * it goes into the GitHub issue / Jira description as a link (a public page of its text) unless "Do not share" is chosen. Saves on leaving a box, keeps every version (restoring one is the undo), and never overwrites a newer save.
 */
export function DocumentsTab({ itemId, canEdit, ctx, tracker = "GitHub" }: { itemId: string; canEdit: boolean; ctx: FieldCtx; /** "GitHub" or "Jira": where this initiative is sent. */ tracker?: string }) {
  const [docs, setDocs] = useState<DocView[] | null>(null);
  // a link from the activity log opens the document: ?item=R-12&tab=spec&doc=<id>
  const [openId, setOpenId] = useState<string | null>(() => {
    const d = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("doc");
    return d && /^[0-9a-f-]{36}$/i.test(d) ? d : null;
  });
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | "docs" | "files" | "links">("all");
  const [over, setOver] = useState(false);
  const filesRef = useRef<FilesHandle>(null);
  const linksRef = useRef<LinksHandle>(null);

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

  const setShared = async (d: DocView, shared: boolean) => {
    setError(null);
    const r = await fetch(`/api/documents/${d.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shared }) });
    if (!r.ok) { setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "The sharing could not be changed."); return; }
    setDocs((cur) => cur?.map((x) => (x.id === d.id ? { ...x, shared } : x)) ?? cur);
  };
  const removeDoc = async (d: DocView) => {
    if (!window.confirm(`Remove the document "${d.title}" and all its versions? This cannot be undone.`)) return;
    const r = await fetch(`/api/documents/${d.id}`, { method: "DELETE" });
    if (r.ok) { if (openId === d.id) setOpenId(null); await load(); } else setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "The document could not be removed.");
  };

  if (!docs) return <Loading>Loading…</Loading>;
  const q = query.trim().toLowerCase();
  const shownDocs = q ? docs.filter((d) => `${d.title} ${DOC_KIND_LABEL[d.kind as keyof typeof DOC_KIND_LABEL] ?? d.kind}`.toLowerCase().includes(q)) : docs;
  const show = (t: "docs" | "files" | "links") => type === "all" || type === t;
  const TYPES: ["all" | "docs" | "files" | "links", string][] = [["all", "All"], ["docs", "Documents"], ["files", "Files"], ["links", "Links"]];
  return (
    <div className={over ? "docs docs-over" : "docs"}
      onDragOver={(e) => { if (canEdit && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
      onDrop={(e) => { setOver(false); if (!canEdit || e.dataTransfer.files.length === 0) return; e.preventDefault(); void filesRef.current?.upload(Array.from(e.dataTransfer.files)); }}>
      <div className="docs-toolbar" role="search">
        <input type="search" value={query} placeholder="Search documents, files and links" aria-label="Search the documents, files and links of this initiative" onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape" && query) { setQuery(""); e.stopPropagation(); } }} />
        <span className="docs-types" role="group" aria-label="Show">
          {TYPES.map(([k, name]) => <button key={k} type="button" className={type === k ? "tool-btn tool-btn-on" : "tool-btn"} aria-pressed={type === k} onClick={() => setType(k)}>{name}</button>)}
        </span>
        {canEdit && (
          <RowMenu label="Add" triggerText="Add ▾" items={[
            { label: "Write a document", onSelect: () => void create(), hidden: docs.length >= MAX_DOCS_PER_ITEM },
            { label: "Upload files", onSelect: () => filesRef.current?.pick() },
            { label: "Add a link", onSelect: () => { setType((t) => (t === "docs" || t === "files" ? "all" : t)); linksRef.current?.startAdd(); } },
          ]} />
        )}
      </div>
      <p className="muted docs-hint">Everything here goes into the {tracker} issue as a link (documents and files open without a login) unless you choose “Only in Product Velocity”. Drag files onto this tab, paste an image or a web address. What builders need first goes in the Description on the Overview tab.</p>
      {error && <p role="alert" className="pf-error">{error}</p>}
      {show("docs") && <>
        <h3>Documents</h3>
        {docs.length === 0 && <p className="muted">No documents yet. Use Add, then Write a document.</p>}
        {docs.length > 0 && shownDocs.length === 0 && <p className="muted">No document matches.</p>}
        <ul className="entry-list">
          {shownDocs.map((d) => (
            <li key={d.id} className="entry-row entry-doc" data-doc={d.title}>
              <RowIcon kind="doc" />
              <span className="entry-main">
                <button type="button" className="entry-name entry-name-btn" aria-expanded={openId === d.id} onClick={() => setOpenId(openId === d.id ? null : d.id)}>{d.title}</button>
                <span className="entry-meta">{DOC_KIND_LABEL[d.kind as keyof typeof DOC_KIND_LABEL] ?? d.kind} · version {d.version} · {STATUS_LABEL[d.status] ?? d.status}{d.aiDraft ? " · AI draft, needs review" : ""}{aiLabel(d.aiTool, d.aiModel) ? ` · written with ${aiLabel(d.aiTool, d.aiModel)}` : ""}</span>
              </span>
              {d.aiDraft
                ? <span className="share-chip" title="A person accepts the AI draft first (open it, then Accept draft)">Held back: AI draft</span>
                : <ShareChip shared={d.shared} tracker={tracker} name={d.title} disabled={!canEdit} onToggle={(on) => void setShared(d, on)} />}
              <RowMenu label={`Actions for ${d.title}`} items={[
                { label: openId === d.id ? "Close" : "Open", onSelect: () => setOpenId(openId === d.id ? null : d.id) },
                { label: "Copy public link", onSelect: () => void navigator.clipboard?.writeText(d.shareUrl ?? "").catch(() => setError("Your browser did not allow copying.")), hidden: !d.shareUrl },
                { label: "Open public page", href: d.shareUrl ?? "", hidden: !d.shareUrl },
                { label: "Remove", onSelect: () => void removeDoc(d), danger: true, hidden: !canEdit },
              ]} />
              {openId === d.id && <div className="entry-expand"><DocEditor id={d.id} canEdit={canEdit} onChanged={load} onRemoved={() => { setOpenId(null); void load(); }} onError={setError} /></div>}
            </li>
          ))}
        </ul>
      </>}
      <div hidden={!show("files")}>
        <h3>Files</h3>
        <FilesControl ref={filesRef} itemId={itemId} disabled={!canEdit} onError={setError} query={query} tracker={tracker} />
      </div>
      <div hidden={!show("links")}>
        <h3>Links</h3>
        <LinksList ref={linksRef} ctx={ctx} itemId={itemId} disabled={!canEdit} onError={setError} query={query} tracker={tracker} />
      </div>
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
