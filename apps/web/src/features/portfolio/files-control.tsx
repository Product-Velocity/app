"use client";

import { Loading } from "@/components/pill-loader";
import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { formatBytes, MAX_FILES_PER_ITEM } from "@pv/domain";
import { NameEdit, RowIcon, RowMenu, ShareChip } from "./attachment-ui";

type FileInfo = { id: string; name: string; mime: string | null; size: number | null; shareUrl: string | null };

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,application/pdf";
const typingIn = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/** What the Spec tab's "Add" menu and drop zone call on the files list. */
export type FilesHandle = { pick: () => void; upload: (files: File[]) => Promise<void> };

/**
 * Files of one initiative (the Spec tab): the same row as documents and links (icon or thumbnail, name, meta, sharing chip, "⋯" menu). Choose, drag and drop
 * (the whole tab is the drop zone, see DocumentsTab) or paste an image. Every new file is shared with the tracker issue by default (its login-free link is
 * turned on at once); the chip turns that off per file.
 */
export const FilesControl = forwardRef<FilesHandle, { itemId: string; disabled: boolean; onError: (e: string | null) => void; /** Shows only the files whose name contains this text. */ query?: string; /** "GitHub" or "Jira": the tracker this initiative is sent to. */ tracker?: string }>(function FilesControl({ itemId, disabled, onError, query = "", tracker = "the issue" }, ref) {
  const id = useId();
  const [files, setFiles] = useState<FileInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/files?item=${encodeURIComponent(itemId)}`);
      if (!r.ok) throw new Error();
      setFiles(((await r.json()) as { files: FileInfo[] }).files);
    } catch {
      setFiles([]);
      onError("Files could not be loaded.");
    }
  }, [itemId, onError]);
  useEffect(() => {
    let live = true;
    void fetch(`/api/files?item=${encodeURIComponent(itemId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { files: FileInfo[] }) => { if (live) setFiles(d.files); })
      .catch(() => { if (live) { setFiles([]); onError("Files could not be loaded."); } });
    return () => { live = false; };
  }, [itemId, onError]);

  const call = async (url: string, init: RequestInit, fail: string) => {
    setBusy(true);
    onError(null);
    try {
      const r = await fetch(url, init);
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) { onError(body.error ?? fail); return null; }
      return body;
    } catch {
      onError(fail);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const uploadFiles = async (list: File[]) => {
    for (const file of list) {
      const form = new FormData();
      form.set("item", itemId);
      form.set("file", file);
      // shared by default (the server turns the link on); the person can switch it off per file
      if (!(await call("/api/files", { method: "POST", body: form }, "The file could not be attached."))) break;
    }
    if (input.current) input.current.value = "";
    await load();
  };
  useImperativeHandle(ref, () => ({ pick: () => input.current?.click(), upload: uploadFiles }));

  // a pasted image becomes a file (not while typing in a box, so pasting text into a document is never intercepted)
  useEffect(() => {
    if (disabled) return;
    const onPaste = (e: ClipboardEvent) => {
      if (typingIn(e.target)) return;
      const imgs = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (imgs.length === 0) return;
      e.preventDefault();
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", ".");
      void uploadFiles(imgs.map((f, i) => (/^image\.\w+$/i.test(f.name) ? new File([f], `Pasted image ${stamp}${imgs.length > 1 ? ` ${i + 1}` : ""}.${f.type.split("/")[1] === "jpeg" ? "jpg" : f.type.split("/")[1]}`, { type: f.type }) : f)));
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, itemId]);

  const remove = async (f: FileInfo) => { if (window.confirm(`Remove the file "${f.name}"? Its link stops working.`) && (await call(`/api/files/${f.id}`, { method: "DELETE" }, "The file could not be removed."))) await load(); };
  const share = async (f: FileInfo, on: boolean) => {
    const r = (await call(`/api/files/${f.id}/share`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on }) }, "The link could not be changed.")) as { shareUrl: string | null } | null;
    if (r) setFiles((cur) => cur?.map((x) => (x.id === f.id ? { ...x, shareUrl: r.shareUrl } : x)) ?? cur);
  };
  const rename = async (f: FileInfo, name: string) => {
    setRenaming(null);
    if (!name.trim() || name === f.name) return;
    const r = (await call(`/api/files/${f.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }, "The file could not be renamed.")) as { name?: string } | null;
    if (r?.name) setFiles((cur) => cur?.map((x) => (x.id === f.id ? { ...x, name: r.name! } : x)) ?? cur);
  };
  const copy = async (f: FileInfo) => {
    if (!f.shareUrl) return;
    try { await navigator.clipboard.writeText(f.shareUrl); setCopied(f.id); setTimeout(() => setCopied(null), 2000); } catch { onError("Your browser did not allow copying. Open the file and copy its address instead."); }
  };

  if (!files) return <Loading inline>Loading…</Loading>;
  const q = query.trim().toLowerCase();
  const shown = q ? files.filter((f) => f.name.toLowerCase().includes(q)) : files;
  const images = shown.filter((f) => f.mime?.startsWith("image/"));
  return (
    <div className="files">
      {files.length === 0 && <p className="muted">No files yet. Choose them, drag them onto this tab or paste an image.</p>}
      {files.length > 0 && shown.length === 0 && <p className="muted">No file matches.</p>}
      <ul className="entry-list">
        {shown.map((f) => {
          const isImage = Boolean(f.mime?.startsWith("image/"));
          return (
            <li key={f.id} className="entry-row" data-file={f.name}>
              <RowIcon kind={isImage ? "image" : "pdf"} src={`/api/files/${f.id}/view`} {...(isImage ? { onClick: () => setOpen(images.findIndex((x) => x.id === f.id)), label: `Preview ${f.name}` } : {})} />
              <span className="entry-main">
                {renaming === f.id
                  ? <NameEdit value={f.name} label={`Name of ${f.name}`} onSave={(v) => void rename(f, v)} onCancel={() => setRenaming(null)} />
                  : <a className="entry-name" href={`/api/files/${f.id}/view`} target="_blank" rel="noreferrer">{f.name}</a>}
                <span className="entry-meta">{[f.mime === "application/pdf" ? "PDF" : f.mime?.replace("image/", "").toUpperCase(), f.size ? formatBytes(f.size) : null].filter(Boolean).join(" · ")}{copied === f.id ? " · Link copied" : ""}</span>
              </span>
              <ShareChip shared={Boolean(f.shareUrl)} tracker={tracker} name={f.name} disabled={disabled} busy={busy} onToggle={(on) => void share(f, on)} />
              <RowMenu label={`Actions for ${f.name}`} items={[
                { label: "Open", href: `/api/files/${f.id}/view` },
                { label: "Download", href: `/api/files/${f.id}/view?download`, download: true },
                { label: "Copy link", onSelect: () => void copy(f), hidden: !f.shareUrl },
                { label: "Rename", onSelect: () => setRenaming(f.id), hidden: disabled },
                { label: "Remove", onSelect: () => void remove(f), danger: true, hidden: disabled },
              ]} />
            </li>
          );
        })}
      </ul>
      {open !== null && images[open] && <Lightbox images={images} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
      {!disabled && <input id={id} ref={input} type="file" multiple hidden accept={ACCEPT} disabled={busy || files.length >= MAX_FILES_PER_ITEM} onChange={(e) => void uploadFiles(Array.from(e.target.files ?? []))} />}
      {busy && <p className="muted" role="status">Working…</p>}
    </div>
  );
});

/** A large view of one image, with Previous and Next. Esc closes it (and not the panel behind it); focus goes to Close and comes back to the thumbnail. */
function Lightbox({ images, index, onIndex, onClose }: { images: FileInfo[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  const f = images[index]!;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => opener?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && index < images.length - 1) onIndex(index + 1);
      else if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      else if (e.key === "Tab") { // keep focus inside the dialog
        const els = Array.from(document.querySelectorAll<HTMLElement>(".lightbox button:not([disabled]), .lightbox a[href]"));
        if (els.length === 0) return;
        const first = els[0]!, last = els[els.length - 1]!;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        return;
      } else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [index, images.length, onClose, onIndex]);
  return (
    <div className="lightbox-backdrop" onClick={onClose}>
      <div className="lightbox" role="dialog" aria-modal="true" aria-label={`Preview of ${f.name}`} onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element -- served by our own authenticated route */}
        <img src={`/api/files/${f.id}/view`} alt={f.name} />
        <p className="lightbox-bar">
          <span>{f.name}{f.size ? ` · ${formatBytes(f.size)}` : ""} · {index + 1} of {images.length}</span>
          <button type="button" className="btn" disabled={index === 0} onClick={() => onIndex(index - 1)}>Previous</button>
          <button type="button" className="btn" disabled={index === images.length - 1} onClick={() => onIndex(index + 1)}>Next</button>
          <a className="btn" href={`/api/files/${f.id}/view?download`}>Download</a>
          <button type="button" className="btn" ref={close} onClick={onClose}>Close</button>
        </p>
      </div>
    </div>
  );
}
