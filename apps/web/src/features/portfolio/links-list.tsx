"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Link } from "@pv/domain";
import { host, NameEdit, RowIcon, RowMenu, ShareChip } from "./attachment-ui";
import type { FieldCtx } from "./item-fields";

/** What the Spec tab's "Add" menu calls on the links list. */
export type LinksHandle = { startAdd: () => void };

/** The page title of a web address, asked of our server (which only reaches the public internet); null when there is none. */
async function titleFor(url: string): Promise<string | null> {
  try {
    const r = await fetch("/api/link-title", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
    return r.ok ? (((await r.json()) as { title?: string | null }).title ?? null) : null;
  } catch { return null; }
}
const typingIn = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/**
 * The links of one initiative (Artifacts), as the same rows as documents and files. A pasted web address (not into a box) is added and named after its
 * page; a link without a name shows its domain. Links go into the tracker issue unless the chip says "Only in Product Velocity".
 */
export const LinksList = forwardRef<LinksHandle, { ctx: FieldCtx; itemId: string; disabled: boolean; onError: (e: string | null) => void; query?: string; tracker?: string }>(function LinksList({ ctx, itemId, disabled, onError, query = "", tracker = "the issue" }, ref) {
  const related = ctx.controller.relatedOf(itemId);
  const list = (related?.artifacts ?? []) as Link[];
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<Link | null>(null);
  const urlBox = useRef<HTMLInputElement>(null);
  const set = (next: unknown[]) => { const r = ctx.controller.editRelated(itemId, "artifacts", next); onError(r.ok ? null : r.error); return r.ok; };
  useImperativeHandle(ref, () => ({ startAdd: () => { setAdding(true); setTimeout(() => urlBox.current?.focus(), 0); } }));

  const add = async (rawUrl: string, rawLabel: string) => {
    const u = rawUrl.trim();
    if (!u) return false;
    let name = rawLabel;
    if (name.trim() === "" && /^https?:\/\//i.test(u)) { setBusy(true); name = (await titleFor(u)) ?? ""; setBusy(false); }
    return set([...list, { label: name, url: u }]);
  };
  useEffect(() => {
    if (disabled || !related) return;
    const onPaste = (e: ClipboardEvent) => {
      if (typingIn(e.target) || (e.clipboardData?.files.length ?? 0) > 0) return;
      const text = e.clipboardData?.getData("text/plain").trim() ?? "";
      if (!/^https?:\/\/\S+$/i.test(text)) return;
      e.preventDefault();
      void add(text, "");
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  if (!related) return <span className="muted" role="status">Loading…</span>;
  const q = query.trim().toLowerCase();
  const shown = q ? list.filter((l) => `${l.label} ${l.url}`.toLowerCase().includes(q)) : list;
  const display = (l: Link) => l.label || host(l.url);
  return (
    <div className="pf-links">
      {list.length === 0 && !adding && <p className="muted">No links yet. Paste a web address anywhere on this tab, or use Add.</p>}
      {list.length > 0 && shown.length === 0 && <p className="muted">No link matches.</p>}
      <ul className="entry-list">
        {shown.map((l) => (
          <li key={`${l.label}|${l.url}`} className="entry-row" data-link={display(l)}>
            <RowIcon kind="link" />
            <span className="entry-main">
              {renaming === l
                ? <NameEdit value={l.label} label={`Name of the link ${display(l)}`} onSave={(v) => { setRenaming(null); if (v !== l.label) set(list.map((x) => (x === l ? { ...x, label: v.trim() } : x))); }} onCancel={() => setRenaming(null)} />
                : <a className="entry-name" href={l.url} target="_blank" rel="noopener noreferrer">{display(l)}</a>}
              <span className="entry-meta">{l.label ? host(l.url) : l.url}</span>
            </span>
            <ShareChip shared={l.shared !== false} tracker={tracker} name={display(l)} disabled={disabled} onToggle={(on) => set(list.map((x) => (x === l ? (on ? { label: l.label, url: l.url } : { ...l, shared: false }) : x)))} />
            <RowMenu label={`Actions for ${display(l)}`} items={[
              { label: "Open", href: l.url },
              { label: "Copy address", onSelect: () => void navigator.clipboard?.writeText(l.url).catch(() => onError("Your browser did not allow copying.")) },
              { label: "Rename", onSelect: () => setRenaming(l), hidden: disabled },
              { label: "Remove", onSelect: () => set(list.filter((x) => x !== l)), danger: true, hidden: disabled },
            ]} />
          </li>
        ))}
      </ul>
      {!disabled && adding && (
        <div className="pf-add-link">
          <input ref={urlBox} type="url" aria-label="Link address" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(url, label).then((ok) => { if (ok) { setUrl(""); setLabel(""); setAdding(false); } }); } else if (e.key === "Escape") { e.stopPropagation(); setAdding(false); } }} />
          <input type="text" aria-label="Link name (optional)" placeholder="Name (optional, we look it up)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <button type="button" className="btn" disabled={busy} onClick={() => void add(url, label).then((ok) => { if (ok) { setUrl(""); setLabel(""); setAdding(false); } })}>{busy ? "Naming…" : "Add link"}</button>
          <button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
});
