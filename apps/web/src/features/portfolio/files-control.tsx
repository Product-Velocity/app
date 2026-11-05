"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { formatBytes, MAX_FILES_PER_ITEM } from "@pv/domain";

type FileInfo = { id: string; name: string; mime: string | null; size: number | null; shareUrl: string | null };

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,application/pdf";
const typingIn = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/**
 * Files of one initiative (the Spec tab): choose, drag and drop, or paste an image. Every new file is shared with the tracker issue by default
 * (its login-free link is turned on at once); "Do not share" turns it off per file. Open and remove work as before.
 */
export function FilesControl({ itemId, disabled, onError, query = "" }: { itemId: string; disabled: boolean; onError: (e: string | null) => void; /** Shows only the files whose name contains this text. */ query?: string }) {
  const id = useId();
  const [files, setFiles] = useState<FileInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

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
  const upload = (list: FileList | null) => uploadFiles(Array.from(list ?? []));

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

  const remove = async (f: FileInfo) => { if (await call(`/api/files/${f.id}`, { method: "DELETE" }, "The file could not be removed.")) await load(); };
  const share = async (f: FileInfo, on: boolean) => {
    const r = (await call(`/api/files/${f.id}/share`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on }) }, "The link could not be changed.")) as { shareUrl: string | null } | null;
    if (r) setFiles((cur) => cur?.map((x) => (x.id === f.id ? { ...x, shareUrl: r.shareUrl } : x)) ?? cur);
  };
  const copy = async (f: FileInfo) => {
    if (!f.shareUrl) return;
    try { await navigator.clipboard.writeText(f.shareUrl); setCopied(f.id); setTimeout(() => setCopied(null), 2000); } catch { onError("Copy the link from the box instead."); }
  };

  if (!files) return <span className="muted" role="status">Loading…</span>;
  const q = query.trim().toLowerCase();
  const shown = q ? files.filter((f) => f.name.toLowerCase().includes(q)) : files;
  const images = shown.filter((f) => f.mime?.startsWith("image/"));
  return (
    <div
      className={over ? "files files-over" : "files"}
      onDragOver={(e) => { if (!disabled && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { setOver(false); if (disabled || e.dataTransfer.files.length === 0) return; e.preventDefault(); void uploadFiles(Array.from(e.dataTransfer.files)); }}
    >
      {files.length === 0 && <p className="muted">No files yet.</p>}
      {files.length > 0 && shown.length === 0 && <p className="muted">No file matches.</p>}
      {images.length > 0 && (
        <ul className="files-thumbs" aria-label="Image previews">
          {images.map((f, i) => (
            <li key={f.id}>
              <button type="button" className="files-thumb" aria-label={`Preview ${f.name}`} onClick={() => setOpen(i)}>
                {/* eslint-disable-next-line @next/next/no-img-element -- served by our own authenticated route, not optimisable */}
                <img src={`/api/files/${f.id}/view`} alt="" loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <ul className="files-list">
        {shown.map((f) => (
          <li key={f.id} className="files-row" data-file={f.name}>
            <a href={`/api/files/${f.id}/view`} target="_blank" rel="noreferrer">{f.name}</a>
            <span className="muted"> {f.size ? formatBytes(f.size) : ""}</span>
            {f.shareUrl && (
              <div className="files-share">
                <input readOnly aria-label={`Share link for ${f.name}`} value={f.shareUrl} onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="btn" onClick={() => copy(f)}>{copied === f.id ? "Copied" : "Copy link"}</button>
              </div>
            )}
            {!disabled && (
              <span className="files-actions">
                <button type="button" className="btn" disabled={busy} onClick={() => share(f, !f.shareUrl)}>{f.shareUrl ? `Do not share ${f.name}` : `Share ${f.name}`}</button>
                <button type="button" className="btn" disabled={busy} onClick={() => remove(f)}>{`Remove ${f.name}`}</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {open !== null && images[open] && <Lightbox images={images} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
      {files.length > 0 && <p className="muted">Shared files go into the GitHub issue or Jira description as a link (private repositories only). Anyone with a link can open that file without signing in. Use “Do not share” to keep one in Product Velocity only.</p>}
      {!disabled && (
        <>
          <label className="btn" htmlFor={id}>{busy ? "Uploading…" : "Attach files"}</label>{" "}
          <span className="muted">or drag files here, or paste an image (⌘V).</span>
          <input id={id} ref={input} type="file" multiple hidden accept={ACCEPT} disabled={busy || files.length >= MAX_FILES_PER_ITEM} onChange={(e) => void upload(e.target.files)} />
        </>
      )}
    </div>
  );
}

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
