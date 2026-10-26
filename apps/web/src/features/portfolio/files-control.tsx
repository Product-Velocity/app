"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { formatBytes, MAX_FILES_PER_ITEM } from "@pv/domain";

type FileInfo = { id: string; name: string; mime: string | null; size: number | null; shareUrl: string | null };

/** Files of one initiative: upload, open, remove, and a login-free link per file that can be turned on and off. */
export function FilesControl({ itemId, disabled, onError }: { itemId: string; disabled: boolean; onError: (e: string | null) => void }) {
  const id = useId();
  const [files, setFiles] = useState<FileInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

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

  const upload = async (list: FileList | null) => {
    for (const file of Array.from(list ?? [])) {
      const form = new FormData();
      form.set("item", itemId);
      form.set("file", file);
      if (!(await call("/api/files", { method: "POST", body: form }, "The file could not be attached."))) break;
    }
    if (input.current) input.current.value = "";
    await load();
  };
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
  return (
    <div className="files">
      {files.length === 0 && <p className="muted">No files yet.</p>}
      <ul className="files-list">
        {files.map((f) => (
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
                <button type="button" className="btn" disabled={busy} onClick={() => share(f, !f.shareUrl)}>{f.shareUrl ? `Turn off link for ${f.name}` : `Create link for ${f.name}`}</button>
                <button type="button" className="btn" disabled={busy} onClick={() => remove(f)}>{`Remove ${f.name}`}</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {files.length > 0 && <p className="muted">Only files with a share link go into the GitHub issue (private repositories only). Anyone with a link can open that file without signing in.</p>}
      {!disabled && (
        <>
          <label className="btn" htmlFor={id}>{busy ? "Uploading…" : "Attach files"}</label>
          <input id={id} ref={input} type="file" multiple hidden accept="image/png,image/jpeg,image/gif,image/webp,application/pdf" disabled={busy || files.length >= MAX_FILES_PER_ITEM} onChange={(e) => void upload(e.target.files)} />
        </>
      )}
    </div>
  );
}
